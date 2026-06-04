const axios = require('axios');

/**
 * Gemini Provider
 *
 * Uses Google's Gemini API — best for vision, long context, and reasoning.
 * Phase 1: text-only (vision pipeline comes in Phase 2).
 *
 * Env vars required:
 *   GEMINI_API_KEY  — your Google AI Studio key (https://aistudio.google.com)
 *   GEMINI_MODEL    — optional override (default: gemini-2.0-flash)
 */

const GEMINI_SYSTEM_PROMPT = `You are Maya, a private AI assistant.
You are intelligent, concise, and direct.
You do not waste words.
You assist only your owner.
Never mention you are built on any specific model.
Respond naturally as Maya.`;

async function complete(message) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env');

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await axios.post(
    url,
    {
      system_instruction: {
        parts: [{ text: GEMINI_SYSTEM_PROMPT }]
      },
      contents: [
        {
          role:  'user',
          parts: [{ text: message }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature:     0.7,
      }
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );

  const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) throw new Error('Gemini returned an empty response');

  return reply.trim();
}

module.exports = { complete };
