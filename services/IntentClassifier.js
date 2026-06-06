const axios = require('axios');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const TOOL_DESCRIPTIONS = `Available tools:
- weather: weather, temperature, rain, forecast, umbrella, jacket, hot, cold
- air_quality: air quality, AQI, pollution
- calendar: schedule, meetings, events, appointments, create meeting
- tasks: to-do, tasks, remind me, pending work
- gmail: email, inbox, send email, read email
- drive: files, documents, notes, google drive
- music: songs, playlist, mood music, feeling sad/happy, play music
- news: headlines, current events, what's happening
- location: where am I, nearby places, hospital, restaurant, ATM
- youtube: videos, tutorials, watch
- wikipedia: who is, what is, history, facts, biography
- vision: image, photo, describe, read text, OCR
- none: general conversation, opinions, advice, coding help`;

const SYSTEM_PROMPT = `You are an intent classifier. Given a user message, identify which tool should handle it.

${TOOL_DESCRIPTIONS}

Respond with ONLY the tool name (one word) from the list above. If no tool matches, respond "none".
Do not explain. Just the tool name.`;

const intentCache = new Map();
const CACHE_MAX = 500;
const CACHE_TTL = 3600000; // 1 hour

function getCacheKey(message) {
  return message.toLowerCase().trim().replace(/\s+/g, ' ').substring(0, 100);
}

async function classify(message) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const cacheKey = getCacheKey(message);
  const cached = intentCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.tool;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const { data } = await axios.post(GROQ_API_URL, {
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message }
      ],
      max_tokens: 10,
      temperature: 0.1,
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 2000,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const raw = (data?.choices?.[0]?.message?.content || '').trim().toLowerCase();
    const tool = raw.replace(/[^a-z_]/g, '');

    const validTools = ['weather','air_quality','calendar','tasks','gmail','drive','music','news','location','youtube','wikipedia','vision','none'];
    const result = validTools.includes(tool) ? tool : null;

    // Cache
    if (result && intentCache.size < CACHE_MAX) {
      intentCache.set(cacheKey, { tool: result, ts: Date.now() });
    }

    console.log(`[IntentClassifier] "${message.substring(0,50)}" → ${result}`);
    return result === 'none' ? null : result;

  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.name === 'AbortError') {
      console.warn('[IntentClassifier] Timeout (2s), falling back');
    } else {
      console.warn(`[IntentClassifier] Error: ${err.message}`);
    }
    return null;
  }
}

module.exports = { classify };
