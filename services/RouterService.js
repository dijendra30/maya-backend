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
    status === 429 ||                              // Rate limit
    status >= 500 ||                              // Server error
    err.code === 'ECONNABORTED' ||                // Timeout
    err.code === 'ETIMEDOUT' ||
    err.code === 'ENOTFOUND' ||                   // Network error
    err.code === 'ECONNREFUSED' ||
    msg.includes('timeout') ||
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('empty') ||
    msg.includes('no response') ||
    msg.includes('returned an empty')
  );
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

      // Non-failover error on the first provider — still try next
      if (nextKey) {
        console.warn(`[Router] ✗ ${key} error (${err.message?.slice(0, 60)}) → trying ${nextKey}`);
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
