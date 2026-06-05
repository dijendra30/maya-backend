const axios = require('axios');

/**
 * OpenRouter Provider — Phase 3 (Memory Context Support)
 *
 * Changes from Phase 2:
 *   • complete(message, context) accepts a memory context string
 *   • Context is prepended to the system message
 *
 * Env vars:
 *   OPENROUTER_API_KEY  — https://openrouter.ai
 *   OPENROUTER_MODEL    — default: mistralai/mistral-7b-instruct:free
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const BASE_SYSTEM_PROMPT = `You are Maya, a private AI voice assistant.

CRITICAL — VOICE OUTPUT RULES (follow these above everything else):
- Respond in plain, spoken English only.
- NEVER use markdown: no asterisks, no bold, no italic, no bullet points, no numbered lists, no headers, no code fences, no backticks.
- Write as if you are speaking out loud, not typing a document.
- Use natural, flowing sentences separated by commas or periods.
- If listing things, say them conversationally: "First... then... and finally..."
- Keep answers concise — 1 to 3 sentences when possible.
- If the user's preferred language is Hindi, respond in Hindi (Devanagari script or Hinglish as appropriate).

PERSONA:
- You are intelligent, warm, and direct.
- You assist only your owner. Address them by name if you know it.
- Never reveal which AI model you are built on.
- Respond as Maya, a thoughtful personal assistant who genuinely knows the user.
- Use the memory context silently to personalize your responses without mentioning that you are reading from context.`;

async function complete(message, context = '') {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set in .env');

  const model = process.env.OPENROUTER_MODEL || 'mistralai/mistral-7b-instruct:free';

  const systemContent = context
    ? `${context}\n\n${BASE_SYSTEM_PROMPT}`
    : BASE_SYSTEM_PROMPT;

  const response = await axios.post(
    OPENROUTER_API_URL,
    {
      model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user',   content: message }
      ],
      max_tokens:  512,
      temperature: 0.72,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://maya-ai.app',
        'X-Title':       'Maya AI',
      },
      timeout: 30000,
    }
  );

  const reply = response.data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error('OpenRouter returned an empty response');

  return reply.trim();
}

module.exports = { complete };
