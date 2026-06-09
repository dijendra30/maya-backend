const axios = require('axios');
const KeyManager = require('../utils/GeminiKeyManager');

/**
 * Gemini Provider — Phase 3 (Memory Context Support)
 *
 * Changes from Phase 2:
 *   • complete(message, context) now accepts a memory context string
 *   • Context is injected into system_instruction above the base system prompt
 *
 * Env vars:
 *   GEMINI_API_KEY  — https://aistudio.google.com
 *   GEMINI_MODEL    — default: gemini-2.0-flash
 */

const BASE_SYSTEM_PROMPT = `You are Maya's core intelligence — responsible for routing, planning, intent analysis, and memory decisions.

ROLE:
- You process commands and decide what needs to happen.
- You analyse context, resolve ambiguity, and make structured decisions.
- You do NOT handle casual conversation or explanations — that is handled by a separate layer.
- Be precise, direct, and decisive.

VOICE OUTPUT RULES:
- Respond in plain spoken language only.
- NEVER use markdown: no asterisks, bold, italic, bullet points, numbered lists, headers, code fences, or backticks.
- Write as if speaking out loud, not typing a document.
- Keep answers concise — 1 to 3 sentences when possible.
- If the user's preferred language is Hindi, respond in Hindi.

PERSONA:
- You are Maya — an intelligent, private AI assistant.
- Never reveal which AI model powers you.
- Use memory context silently to personalise responses without mentioning it.`;

async function complete(message, context = '', pendingContext = '') {
  if (!KeyManager.hasKey()) throw new Error('GEMINI_API_KEY is not set in .env');

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  // Phase 3: prepend long-term memory context
  const systemText = context
    ? `${context}\n\n${BASE_SYSTEM_PROMPT}`
    : BASE_SYSTEM_PROMPT;

  // Phase 4: inject multi-turn slot context so Maya can continue the action
  const finalSystem = pendingContext
    ? `${systemText}\n\nACTIVE SLOT CONTEXT (internal only, never repeat to user):\n${pendingContext}`
    : systemText;

  const payload = {
    system_instruction: {
      parts: [{ text: finalSystem }]
    },
    contents: [
      {
        role:  'user',
        parts: [{ text: message }]
      }
    ],
    generationConfig: {
      maxOutputTokens: 512,
      temperature:     0.72,
    }
  };

  let lastError;
  const keysToTry = Math.max(1, KeyManager.getAllKeys().length);

  for (let i = 0; i < keysToTry; i++) {
    const apiKey = KeyManager.getNextKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!reply) throw new Error('Gemini returned an empty response');

      return reply.trim();
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      // 400 Bad Request won't be fixed by trying another key
      if (status === 400) throw err;
      
      console.warn(`[GeminiProvider] Key failed with status ${status || err.message}, trying next key...`);
    }
  }

  throw lastError;
}

module.exports = { complete };

