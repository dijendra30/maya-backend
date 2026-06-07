/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 *  Maya AI — Production Router Service  (Phase 6)
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * AI Provider Priority (spec requirement):
 *   Router   : Gemini Flash → Groq → OpenRouter
 *   General  : Gemini Flash → Groq → OpenRouter
 *
 * Automatic failover on:
 *   - Rate limit (429)      - Timeout / ECONNABORTED
 *   - Empty response        - API error (5xx)
 *   - Network error         - Any thrown exception
 *
 * User NEVER sees provider failures.
 *
 * Debug logging (set DEBUG_ROUTING=true in .env):
 *   [Router] Detected Intent | Extracted Entities | Selected Tool
 *   [Router] Execution Result | Execution Time | Selected AI Provider
 *   [Router] Fallback Events
 */

const GeminiProvider     = require('../providers/GeminiProvider');
const GroqProvider       = require('../providers/GroqProvider');
const OpenRouterProvider = require('../providers/OpenRouterProvider');

// ── Provider Registry ──────────────────────────────────────────────────────
const PROVIDERS = {
  gemini:     GeminiProvider,
  groq:       GroqProvider,
  openrouter: OpenRouterProvider,
};

// ── Priority Chain (spec: Gemini Flash → Groq → OpenRouter) ───────────────
const AI_PROVIDER_CHAIN = ['gemini', 'groq', 'openrouter'];

// ── Failover Trigger Detection ─────────────────────────────────────────────
function isFailoverTrigger(err) {
  if (!err) return false;
  const msg    = (err.message || '').toLowerCase();
  const status = err.response?.status;
  return (
    status === 400 ||                              // Bad request (malformed call)
    status === 401 ||                              // Unauthorized — bad API key
    status === 403 ||                              // Forbidden — billing/quota
    status === 429 ||                              // Rate limit
    status >= 500 ||                               // Server error
    err.code === 'ECONNABORTED' ||                 // Timeout
    err.code === 'ETIMEDOUT' ||
    err.code === 'ENOTFOUND' ||                    // Network error
    err.code === 'ECONNREFUSED' ||
    msg.includes('timeout') ||
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('empty') ||
    msg.includes('no response') ||
    msg.includes('returned an empty') ||
    msg.includes('not set') ||                     // GEMINI_API_KEY not set in .env
    msg.includes('api key') ||                     // generic key error
    msg.includes('unauthorized') ||
    msg.includes('invalid') ||
    msg.includes('forbidden')
  );
}

// ── Provider Key Pre-flight ────────────────────────────────────────────────
// Checks API key presence BEFORE calling the provider, so missing keys are
// logged clearly and skipped — not silently swallowed by the catch block.
function providerHasKey(key) {
  switch (key) {
    case 'gemini':     return !!(process.env.GEMINI_API_KEY     && process.env.GEMINI_API_KEY     !== 'your_gemini_api_key_here');
    case 'groq':       return !!(process.env.GROQ_API_KEY       && process.env.GROQ_API_KEY       !== 'your_groq_api_key_here');
    case 'openrouter': return !!(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'your_openrouter_api_key_here');
    default:           return false;
  }
}

// ── Debug Logger ───────────────────────────────────────────────────────────
function dbg(label, data) {
  if (process.env.DEBUG_ROUTING !== 'true') return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[Router:${ts}] ${label}`, typeof data === 'object' ? JSON.stringify(data) : data);
}

// ── Main Route Entry ───────────────────────────────────────────────────────

/**
 * Route a message through the AI provider chain.
 *
 * @param {string} message        User message (may be entity-augmented)
 * @param {string} context        Long-term memory context
 * @param {string} pendingContext Multi-turn slot context
 * @returns {Promise<{ reply: string, provider: string }>}
 */
async function route(message, context = '', pendingContext = '') {
  const t0        = Date.now();
  let   lastError = null;

  dbg('AI Route', { message: message.slice(0, 80), hasContext: !!context, hasPending: !!pendingContext });

  for (let i = 0; i < AI_PROVIDER_CHAIN.length; i++) {
    const key      = AI_PROVIDER_CHAIN[i];
    const provider = PROVIDERS[key];

    if (!provider) {
      console.warn(`[Router] Unknown provider key skipped: "${key}"`);
      continue;
    }

    // Pre-flight: skip providers with missing/placeholder API keys immediately
    // so the log clearly shows WHY Gemini was skipped (not silently swallowed).
    if (!providerHasKey(key)) {
      const nextKey = AI_PROVIDER_CHAIN[i + 1] || null;
      console.warn(`[Router] ⚠ ${key}: API key not configured — skipping${nextKey ? ` → trying ${nextKey}` : ''}`);
      continue;
    }

    const isFirst  = i === 0;
    const isFallback = !isFirst;

    try {
      const reply = await provider.complete(message, context, pendingContext);

      // Empty-response failover
      if (!reply || !reply.trim()) {
        const emptyErr = new Error(`${key} returned empty response`);
        dbg('Failover:Empty', { from: key, to: AI_PROVIDER_CHAIN[i + 1] || 'none' });
        console.warn(`[Router] ✗ ${key} empty response — triggering failover`);
        lastError = emptyErr;
        continue;
      }

      const elapsedMs = Date.now() - t0;
      if (isFallback) {
        console.log(`[Router] ⚡ Fallback activated → ${key} | elapsedMs=${elapsedMs}`);
        dbg('Fallback:Success', { provider: key, elapsedMs });
      } else {
        dbg('Success', { provider: key, elapsedMs });
      }

      return { reply: reply.trim(), provider: key };

    } catch (err) {
      lastError = err;

      const shouldFailover = isFailoverTrigger(err);
      const nextKey        = AI_PROVIDER_CHAIN[i + 1] || null;

      if (shouldFailover && nextKey) {
        console.warn(`[Router] ✗ ${key} failed (${err.message?.slice(0, 60)}) → failover to ${nextKey}`);
        dbg('Failover:Trigger', { from: key, to: nextKey, reason: err.message?.slice(0, 60) });
        continue;
      }

      // Unexpected error — still try next provider but log it clearly
      if (nextKey) {
        console.error(`[Router] ✗ ${key} unexpected error → trying ${nextKey} | reason: ${err.message?.slice(0, 80)}`);
        continue;
      }

      // No more providers
      break;
    }
  }

  // All providers exhausted
  const fatal = new Error(`All AI providers failed. Last: ${lastError?.message || 'unknown'}`);
  fatal.provider = 'none';
  console.error(`[Router] ✗ ALL providers failed after ${Date.now() - t0}ms`);
  throw fatal;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function containsAny(text, keywords) {
  return keywords.some(k => text.includes(k));
}

module.exports = { route };
