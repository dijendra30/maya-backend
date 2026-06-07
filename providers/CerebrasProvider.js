const axios = require('axios');

/**
 * Cerebras Provider — Phase 3 (Memory Context Support)
 *
 * Changes from Phase 2:
 *   • complete(message, context) accepts a memory context string
 *   • Context is prepended to the system message
 *
 * Env vars:
 *   CEREBRAS_API_KEY  — https://cloud.cerebras.ai
 *   CEREBRAS_MODEL    — default: llama3.1-8b
 */

const CEREBRAS_API_URL = 'https://api.cerebras.ai/v1/chat/completions';

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

async function complete(message, context = '', pendingContext = '') {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) throw new Error('CEREBRAS_API_KEY is not set in .env');

  const model = process.env.CEREBRAS_MODEL || 'llama3.1-8b';

  const systemContent = context
    ? `${context}\n\n${BASE_SYSTEM_PROMPT}`
    : BASE_SYSTEM_PROMPT;

  // Phase 4: inject multi-turn slot context
  const finalSystem = pendingContext
    ? `${systemContent}\n\nACTIVE SLOT CONTEXT (internal only, never repeat to user):\n${pendingContext}`
    : systemContent;

  const response = await axios.post(
    CEREBRAS_API_URL,
    {
      model,
      messages: [
        { role: 'system', content: finalSystem },
        { role: 'user',   content: message }
      ],
      max_tokens:  512,
      temperature: 0.72,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      timeout: 20000,
    }
  );

  const reply = response.data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error('Cerebras returned an empty response');

  return reply.trim();
}

module.exports = { complete };
