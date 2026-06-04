const GeminiProvider     = require('../providers/GeminiProvider');
const GroqProvider       = require('../providers/GroqProvider');
const CerebrasProvider   = require('../providers/CerebrasProvider');
const OpenRouterProvider = require('../providers/OpenRouterProvider');

// OllamaProvider intentionally NOT registered in Phase 1.
// The file is preserved at src/providers/OllamaProvider.js for Phase 2.

/**
 * ┌─────────────────────────────────────────────────────────────────┐
 *  Maya AI Router — Phase 1
 *  Google Cloud Free VPS edition (no local model execution)
 * └─────────────────────────────────────────────────────────────────┘
 *
 * ROUTING STRATEGY
 * ─────────────────
 *   Reasoning / Complex / Long / Code  →  Gemini
 *   Fast Chat / General Assistant      →  Groq
 *
 * FAILOVER CHAIN  (automatic — user never sees errors)
 * ─────────────────
 *   Gemini  →  Groq  →  Cerebras  →  OpenRouter
 *
 * HOW TO ADD A NEW PROVIDER (Phase 2 and beyond)
 * ─────────────────
 *   1. Create src/providers/NewProvider.js
 *      Must export:  async function complete(message) => string
 *   2. require() it at the top of this file
 *   3. Add it to PROVIDERS registry below
 *   4. Optionally insert it into FAILOVER_CHAIN at the right position
 *   That's it — no other file needs to change.
 */

// ── Provider Registry ─────────────────────────────────────────────────────
// Phase 1: Gemini, Groq, Cerebras, OpenRouter only.
// Future keys to add: ollama, deepseek, claude, openai, qwen

const PROVIDERS = {
  gemini:     GeminiProvider,
  groq:       GroqProvider,
  cerebras:   CerebrasProvider,
  openrouter: OpenRouterProvider,
};

// ── Failover Chain ────────────────────────────────────────────────────────
// If the selected provider fails, the router walks this list in order.
// Primary provider is always tried first; chain order handles the rest.

const FAILOVER_CHAIN = ['gemini', 'groq', 'cerebras', 'openrouter'];

// ── Routing Keywords ──────────────────────────────────────────────────────

// Messages matching any of these keywords are routed to Gemini.
// Gemini handles: reasoning, analysis, complexity, long output, code.
const GEMINI_TRIGGERS = [
  // Reasoning & analysis
  'reason', 'reasoning', 'why does', 'why is', 'why do', 'explain why',
  'step by step', 'think through', 'analyze', 'analyse', 'analysis',
  'deduce', 'infer', 'logic', 'logical', 'evaluate', 'assessment',
  'break down', 'breakdown',
  // Complex comparisons & deep questions
  'compare', 'comparison', 'difference between', 'pros and cons',
  'advantages', 'disadvantages', 'what happens if', 'implications',
  'consequences', 'philosophy', 'deep dive', 'how does it work',
  // Long / detailed output
  'explain in detail', 'detailed explanation', 'comprehensive',
  'elaborate', 'full guide', 'in-depth', 'summarize', 'summary',
  'essay', 'report', 'write a detailed', 'write a full', 'overview of',
  // Coding & debugging (moved from Ollama → Gemini for Phase 1)
  'code', 'function', 'class ', 'debug', 'error in', 'fix this',
  'refactor', 'explain this code', 'write a script', 'write a function',
  'python', 'javascript', 'kotlin', 'java ', 'typescript',
  'bash ', 'shell ', 'algorithm', 'compile', 'runtime error', 'syntax error',
  'sql', 'query', 'regex', 'api call',
  // Vision / image (text queries about images — pipeline extends in Phase 2)
  'image', 'photo', 'picture', 'screenshot', 'describe this', 'vision',
];

// ── Provider Selection ────────────────────────────────────────────────────

/**
 * Selects the best provider for a given message.
 * Rules are evaluated top-to-bottom; first match wins.
 *
 * @param   {string} message  User message
 * @returns {string}          Provider key
 */
function selectProvider(message) {
  const lower = message.toLowerCase();

  // Reasoning / complex / code / long → Gemini
  if (containsAny(lower, GEMINI_TRIGGERS)) {
    return 'gemini';
  }

  // Fast chat / general assistant → Groq
  // Respect DEFAULT_PROVIDER override from .env if set to gemini
  const defaultProvider = process.env.DEFAULT_PROVIDER || 'groq';
  return PROVIDERS[defaultProvider] ? defaultProvider : 'groq';
}

// ── Router Entry Point ────────────────────────────────────────────────────

/**
 * Route a message to the best available provider.
 * Walks the failover chain automatically on any provider failure.
 * The user never sees raw provider errors.
 *
 * @param   {string} message  User message
 * @returns {Promise<{ reply: string, provider: string }>}
 */
async function route(message) {
  const primary = selectProvider(message);

  // Execution chain: primary first, then remaining providers in failover order
  const chain = [
    primary,
    ...FAILOVER_CHAIN.filter(key => key !== primary),
  ];

  let lastError;

  for (const key of chain) {
    const provider = PROVIDERS[key];

    if (!provider) {
      console.warn(`[Router] Skipping unknown provider key: "${key}"`);
      continue;
    }

    try {
      const reply = await provider.complete(message);

      // Log fallback usage so issues are visible in VPS logs
      if (key !== primary) {
        console.log(`[Router] ⚡ Fallback activated: ${primary} → ${key}`);
      } else {
        console.log(`[Router] ✓ Routed to: ${key}`);
      }

      return { reply, provider: key };

    } catch (err) {
      console.warn(`[Router] ✗ ${key} failed: ${err.message}`);
      lastError = err;
      // Continue to next provider in chain
    }
  }

  // All 4 providers exhausted — propagate error to chatController
  const fatal      = new Error(`All providers failed. Last error: ${lastError?.message || 'unknown'}`);
  fatal.provider   = 'none';
  throw fatal;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function containsAny(text, keywords) {
  return keywords.some(k => text.includes(k));
}

module.exports = { route, selectProvider };
