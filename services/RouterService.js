const GeminiProvider     = require('../providers/GeminiProvider');
const GroqProvider       = require('../providers/GroqProvider');
const CerebrasProvider   = require('../providers/CerebrasProvider');
const OpenRouterProvider = require('../providers/OpenRouterProvider');

/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 *  Maya AI Router — Phase 3 (Memory Context Support)
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Changes from Phase 2:
 *   • route(message, context) now accepts a memory context string
 *   • Context is forwarded to every provider's complete(message, context) call
 *   • All providers inject context into their system prompt
 *   • Maya now "remembers" the user across sessions
 *
 * ROUTING STRATEGY (unchanged)
 * ─────────────────
 *   Reasoning / Complex / Long / Code  →  Gemini
 *   Fast Chat / General Assistant      →  Groq
 *
 * FAILOVER CHAIN  (automatic — user never sees errors)
 * ─────────────────
 *   Gemini  →  Groq  →  Cerebras  →  OpenRouter
 */

// ── Provider Registry ──────────────────────────────────────────────────────
const PROVIDERS = {
  gemini:     GeminiProvider,
  groq:       GroqProvider,
  cerebras:   CerebrasProvider,
  openrouter: OpenRouterProvider,
};

// ── Failover Chain ─────────────────────────────────────────────────────────
const FAILOVER_CHAIN = ['gemini', 'groq', 'cerebras', 'openrouter'];

// ── Routing Keywords ───────────────────────────────────────────────────────
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
  // Coding & debugging
  'code', 'function', 'class ', 'debug', 'error in', 'fix this',
  'refactor', 'explain this code', 'write a script', 'write a function',
  'python', 'javascript', 'kotlin', 'java ', 'typescript',
  'bash ', 'shell ', 'algorithm', 'compile', 'runtime error', 'syntax error',
  'sql', 'query', 'regex', 'api call',
  // Vision / image queries
  'image', 'photo', 'picture', 'screenshot', 'describe this', 'vision',
];

// ── Provider Selection ─────────────────────────────────────────────────────
function selectProvider(message) {
  const lower = message.toLowerCase();
  if (containsAny(lower, GEMINI_TRIGGERS)) return 'gemini';
  const defaultProvider = process.env.DEFAULT_PROVIDER || 'groq';
  return PROVIDERS[defaultProvider] ? defaultProvider : 'groq';
}

// ── Router Entry Point ─────────────────────────────────────────────────────

/**
 * Route a message to the best available provider.
 * Memory context and pending slot context are forwarded to every provider.
 *
 * @param   {string} message        User message
 * @param   {string} context        Memory context from MemoryManager (may be empty)
 * @param   {string} pendingContext Multi-turn slot context, e.g. "[PENDING_ACTION intent=send_message recipient=Dad]"
 * @returns {Promise<{ reply: string, provider: string }>}
 */
async function route(message, context = '', pendingContext = '') {
  const primary = selectProvider(message);
  const chain = [primary, ...FAILOVER_CHAIN.filter(key => key !== primary)];

  let lastError;

  for (const key of chain) {
    const provider = PROVIDERS[key];
    if (!provider) {
      console.warn(`[Router] Skipping unknown provider key: "${key}"`);
      continue;
    }

    try {
      const reply = await provider.complete(message, context, pendingContext);

      if (key !== primary) {
        console.log(`[Router] ⚡ Fallback activated: ${primary} → ${key}`);
      } else {
        console.log(`[Router] ✓ Routed to: ${key} | memory: ${context ? 'YES' : 'NO'} | slot: ${pendingContext ? 'YES' : 'NO'}`);
      }

      return { reply, provider: key };

    } catch (err) {
      console.warn(`[Router] ✗ ${key} failed: ${err.message}`);
      lastError = err;
    }
  }

  const fatal = new Error(`All providers failed. Last error: ${lastError?.message || 'unknown'}`);
  fatal.provider = 'none';
  throw fatal;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function containsAny(text, keywords) {
  return keywords.some(k => text.includes(k));
}

module.exports = { route, selectProvider };
