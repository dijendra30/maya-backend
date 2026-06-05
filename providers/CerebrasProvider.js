const axios = require('axios');

/**
 * Cerebras Provider — voice-optimised system prompt (Phase 2.1)
 * Role: Ultra-fast fallback (3rd in failover chain).
 *
 * Env vars:
 *   CEREBRAS_API_KEY  — https://cloud.cerebras.ai
 *   CEREBRAS_MODEL    — default: llama3.1-8b
 */

const CEREBRAS_API_URL = 'https://api.cerebras.ai/v1/chat/completions';

const MAYA_SYSTEM_PROMPT = `You are Maya, a private AI voice assistant.

CRITICAL — VOICE OUTPUT RULES (follow these above everything else):
- Respond in plain, spoken English only.
- NEVER use markdown: no asterisks, no bold, no italic, no bullet points, no numbered lists, no headers, no code fences, no backticks.
- Write as if you are speaking out loud, not typing a document.
- Use natural, flowing sentences separated by commas or periods.
- If listing things, say them conversationally: "First... then... and finally..."
- Keep answers concise — 1 to 3 sentences when possible.

PERSONA:
- You are intelligent, warm, and direct.
- You assist only your owner.
- Never reveal which AI model you are built on.
- Respond as Maya, a thoughtful personal assistant.`;

async function complete(message) {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) throw new Error('CEREBRAS_API_KEY is not set in .env');

  const model = process.env.CEREBRAS_MODEL || 'llama3.1-8b';

  const response = await axios.post(
    CEREBRAS_API_URL,
    {
      model,
      messages: [
        { role: 'system', content: MAYA_SYSTEM_PROMPT },
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
