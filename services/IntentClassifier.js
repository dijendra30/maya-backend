/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 *  Maya AI — Intent Classifier  (Phase 6 — Production)
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Provider priority (spec requirement):
 *   Router: Gemini Flash → Groq → OpenRouter
 *
 * Intent list (spec):
 *   calendar, gmail, weather, maps, music, wikipedia, news,
 *   send_message, call_contact, open_app, google_drive,
 *   device_control, knowledge_query, general_chat
 *
 * Entity extraction examples (spec):
 *   "Who is APJ Abdul Kalam"     → topic: APJ Abdul Kalam
 *   "Weather in Delhi tomorrow"  → city: Delhi, time: tomorrow
 *   "Send message to Dad"        → recipient: Dad
 *
 * Cache: in-memory LRU, 1 hour TTL, 500 entries max
 */

const axios = require('axios');

// ── LLM Endpoints ──────────────────────────────────────────────────────────
const GEMINI_CLASSIFY_URL = (key, model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

// ── Prompts ─────────────────────────────────────────────────────────────────
const VALID_INTENTS = [
  'calendar','gmail','weather','maps','music','wikipedia','news',
  'send_message','call_contact','open_app','google_drive',
  'device_control','knowledge_query','general_chat',
  // internal tool names also accepted
  'air_quality','location','youtube','vision','tasks','drive',
];

const SYSTEM_PROMPT = `You are an intent classifier for a voice assistant.

Given a user message, identify the single best intent:
  calendar       – schedule, meetings, events, appointments
  gmail          – STRICTLY for Email. (read email, send email, inbox, gmail)
  weather        – weather, temperature, rain, forecast, humidity
  maps           – navigate, directions, nearest place, open maps
  music          – play music, songs, playlist, mood-based music
  wikipedia      – who is, what is, explain, history, biography, facts
  news           – headlines, current events, breaking news, latest news
  send_message   – STRICTLY for WhatsApp, SMS, text messages. (send whatsapp, text, message, say hi to)
  call_contact   – call someone, dial, ring
  open_app       – open instagram, launch spotify, go to youtube
  google_drive   – find file, search drive, my notes, documents
  device_control – flashlight, volume, alarm, timer, camera, settings
  knowledge_query – general knowledge question not covered above
  general_chat   – conversation, opinion, advice, help with a task
  air_quality    – AQI, pollution level
  location       – where am I, nearby hospital/ATM/restaurant
  youtube        – watch video, find tutorial on youtube
  vision         – analyze image, describe photo
  tasks          – to-do, tasks, remind me

ENTITY EXTRACTION:
Also extract entities from the message:
  city    → city name for weather/maps
  topic   → person/concept for wikipedia/knowledge
  recipient → person name for send_message/call_contact
  app     → app name for open_app
  query   → search term for music/youtube/drive

Respond with ONLY a JSON object (no markdown, no explanation):
{"intent":"<intent>","entities":{"city":"...","topic":"...","recipient":"...","app":"...","query":"..."}}
Omit entity fields that are not present. Never include empty strings.`;

// ── Cache ──────────────────────────────────────────────────────────────────
const intentCache = new Map();
const CACHE_MAX   = 500;
const CACHE_TTL   = 3_600_000; // 1 hour

function getCacheKey(message) {
  return message.toLowerCase().trim().replace(/\s+/g, ' ').substring(0, 100);
}

function cacheGet(key) {
  const e = intentCache.get(key);
  if (!e || Date.now() - e.ts > CACHE_TTL) { intentCache.delete(key); return null; }
  return e;
}

function cachePut(key, intent, entities) {
  if (intentCache.size >= CACHE_MAX) {
    // evict oldest
    const first = intentCache.keys().next().value;
    intentCache.delete(first);
  }
  intentCache.set(key, { intent, entities: entities || {}, ts: Date.now() });
}

// ── Gemini Classify ────────────────────────────────────────────────────────
async function classifyWithGemini(message) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const model  = process.env.GEMINI_ROUTER_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 3000);

  try {
    console.log(`[ROUTER] Gemini Called: "${message.slice(0, 50)}..."`);
    const { data } = await axios.post(
      GEMINI_CLASSIFY_URL(apiKey, model),
      {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: { maxOutputTokens: 80, temperature: 0.0 },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
        timeout: 3000,
      }
    );
    clearTimeout(timer);
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`[ROUTER] Gemini Result: ${raw.replace(/\n/g, '')}`);
    return parseClassifyResponse(raw);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Groq Classify ──────────────────────────────────────────────────────────
async function classifyWithGroq(message) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');
  const model  = process.env.GROQ_ROUTER_MODEL || 'llama-3.1-8b-instant';

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 2500);

  try {
    const { data } = await axios.post(
      GROQ_URL,
      {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: message },
        ],
        max_tokens:  80,
        temperature: 0.0,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json',
        },
        signal:  controller.signal,
        timeout: 2500,
      }
    );
    clearTimeout(timer);
    const raw = data?.choices?.[0]?.message?.content || '';
    return parseClassifyResponse(raw);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Response Parser ────────────────────────────────────────────────────────
function parseClassifyResponse(raw) {
  try {
    const clean  = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const intent = (parsed.intent || '').toLowerCase().replace(/[^a-z_]/g, '');
    const ents   = parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {};
    // Remove empty-string entity values
    Object.keys(ents).forEach(k => { if (!ents[k]) delete ents[k]; });
    if (VALID_INTENTS.includes(intent)) return { intent, entities: ents };
    return null;
  } catch {
    // Fallback: just try to extract intent word
    const word = raw.trim().toLowerCase().replace(/[^a-z_]/g, '');
    return VALID_INTENTS.includes(word) ? { intent: word, entities: {} } : null;
  }
}

// ── Main Classify Entry ────────────────────────────────────────────────────

/**
 * Classify intent and extract entities.
 *
 * Provider priority: Gemini Flash → Groq
 * Returns { intent, entities } or null if all providers fail.
 *
 * @param {string} message
 * @returns {Promise<{intent: string, entities: object}|null>}
 */
async function classify(message) {
  const cacheKey = getCacheKey(message);
  const cached   = cacheGet(cacheKey);
  if (cached) {
    if (process.env.DEBUG_ROUTING === 'true') {
      console.log(`[IntentClassifier] Cache hit: "${message.slice(0,50)}" → ${cached.intent}`);
    }
    return { intent: cached.intent, entities: cached.entities };
  }

  const providers = [
    { name: 'gemini', fn: () => classifyWithGemini(message) },
    { name: 'groq',   fn: () => classifyWithGroq(message)   },
  ];

  for (const { name, fn } of providers) {
    try {
      const result = await fn();
      if (result) {
        cachePut(cacheKey, result.intent, result.entities);
        if (process.env.DEBUG_ROUTING === 'true') {
          console.log(`[IntentClassifier] "${message.slice(0,50)}" → ${result.intent} | entities:`, result.entities, `| provider: ${name}`);
        } else {
          console.log(`[IntentClassifier] "${message.slice(0,50)}" → ${result.intent} (${name})`);
        }
        return result;
      }
    } catch (err) {
      console.warn(`[IntentClassifier] ${name} failed: ${err.message?.slice(0, 80)}`);
    }
  }

  console.warn(`[IntentClassifier] All classifiers failed for: "${message.slice(0,50)}"`);
  return null;
}

module.exports = { classify };
