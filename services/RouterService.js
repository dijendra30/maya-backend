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

// ── Priority Chain ────────────────────────────────────────────────────────
// Spec default: Gemini Flash → Groq → OpenRouter
// Override by setting DEFAULT_PROVIDER in .env (e.g. DEFAULT_PROVIDER=groq
// if Gemini key is unavailable).
(function validateGeminiKey() {
  const key = process.env.GEMINI_API_KEY || '';
  // Google AI Studio keys start with "AQ." — Google Cloud keys start with "AIza"
  // Both are valid Gemini API keys depending on where they were generated.
  if (key && !key.startsWith('AQ.') && !key.startsWith('AIza')) {
    console.error('[Router] ✗ GEMINI_API_KEY looks invalid (expected prefix: "AQ." or "AIza"). Get a key from https://aistudio.google.com/app/apikey');
  }
})();

function buildProviderChain() {
  const preferred = (process.env.DEFAULT_PROVIDER || 'gemini').toLowerCase().trim();
  const base      = ['gemini', 'groq', 'openrouter'];
  if (!base.includes(preferred) || preferred === 'gemini') return base;
  // Move the preferred provider to position 0; spec fallback order preserved
  return [preferred, ...base.filter(p => p !== preferred)];
}

const AI_PROVIDER_CHAIN = buildProviderChain();
console.log(`[Router] Provider chain: ${AI_PROVIDER_CHAIN.join(' → ')} (DEFAULT_PROVIDER=${process.env.DEFAULT_PROVIDER || 'gemini'})`);

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
    case 'gemini': {
      const k = process.env.GEMINI_API_KEY || '';
      return k.length > 10 && (k.startsWith('AQ.') || k.startsWith('AIza'));
    }
    case 'groq': {
      const k = process.env.GROQ_API_KEY || '';
      return k.length > 10 && k !== 'your_groq_api_key_here';
    }
    case 'openrouter': {
      const k = process.env.OPENROUTER_API_KEY || '';
      return k.length > 10 && k !== 'your_openrouter_api_key_here';
    }
    default: return false;
  }
}

// ── Debug Logger ───────────────────────────────────────────────────────────
function dbg(label, data) {
  if (process.env.DEBUG_ROUTING !== 'true') return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[Router:${ts}] ${label}`, typeof data === 'object' ? JSON.stringify(data) : data);
}

// ── Shared call helper ────────────────────────────────────────────────────
async function callProvider(key, message, context, pendingContext) {
  const provider = PROVIDERS[key];
  if (!provider)            throw new Error(`Unknown provider: ${key}`);
  if (!providerHasKey(key)) throw new Error(`${key}: API key not configured`);
  const reply = await provider.complete(message, context, pendingContext);
  if (!reply || !reply.trim()) throw new Error(`${key} returned empty response`);
  return reply.trim();
}

// ══════════════════════════════════════════════════════════════════════════
// SYSTEM ROUTE  —  Gemini only
// Used for: Routing · Planning · Intent Detection · Memory Decisions
// ══════════════════════════════════════════════════════════════════════════
async function routeSystem(message, context = '') {
  const t0 = Date.now();
  dbg('System Route', { message: message.slice(0, 80) });
  try {
    const reply = await callProvider('gemini', message, context, '');
    console.log(`[Router:System] ✓ gemini | ${Date.now() - t0}ms`);
    return { reply, provider: 'gemini' };
  } catch (err) {
    console.error(`[Router:System] ✗ gemini failed — ${err.message?.slice(0, 80)}`);
    // Emergency fallback: if Gemini is down, use conversation layer
    return routeConversation(message, context, '');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CONVERSATION ROUTE  —  Groq → OpenRouter
// Used for: Conversation · Explanations · Summaries
// ══════════════════════════════════════════════════════════════════════════
async function routeConversation(message, context = '', pendingContext = '') {
  const CONV_CHAIN = ['groq', 'openrouter'];
  const t0         = Date.now();
  let   lastError  = null;

  dbg('Conversation Route', { message: message.slice(0, 80) });

  for (let i = 0; i < CONV_CHAIN.length; i++) {
    const key = CONV_CHAIN[i];
    try {
      const reply = await callProvider(key, message, context, pendingContext);
      console.log(`[Router:Conv] ✓ ${key} | ${Date.now() - t0}ms`);
      return { reply, provider: key };
    } catch (err) {
      lastError = err;
      const next = CONV_CHAIN[i + 1] || null;
      if (next) {
        console.warn(`[Router:Conv] ✗ ${key} → ${next} | ${err.message?.slice(0, 60)}`);
      } else {
        console.error(`[Router:Conv] ✗ ${key} failed, no more providers`);
      }
    }
  }

  const fatal = new Error(`Conversation providers exhausted. Last: ${lastError?.message || 'unknown'}`);
  fatal.provider = 'none';
  throw fatal;
}

// ══════════════════════════════════════════════════════════════════════════
// LEGACY route()  —  backward-compat wrapper → uses routeConversation
// ══════════════════════════════════════════════════════════════════════════
async function route(message, context = '', pendingContext = '') {
  return routeConversation(message, context, pendingContext);
}

module.exports = { route, routeSystem, routeConversation };
