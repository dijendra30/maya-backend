const axios = require('axios');

/**
 * Gemini Provider — voice-optimised system prompt (Phase 2.1)
 *
 * Env vars:
 *   GEMINI_API_KEY  — https://aistudio.google.com
 *   GEMINI_MODEL    — default: gemini-2.0-flash
 */

const GEMINI_SYSTEM_PROMPT = `You are Maya, a private AI voice assistant.

CRITICAL — VOICE OUTPUT RULES (follow these above everything else):
- Respond in plain, spoken English only.
- NEVER use markdown: no asterisks, no bold, no italic, no bullet points, no numbered lists, no headers, no code fences, no backticks.
- Write as if you are speaking out loud, not typing a document.
- Use natural, flowing sentences separated by commas or periods.
- If listing things, say them conversationally: "First... then... and finally..."
- Keep answers concise — 1 to 3 sentences when possible.
- If a longer answer is needed, use short paragraphs with natural transitions.

PERSONA:
- You are intelligent, warm, and direct.
- You assist only your owner.
- Never reveal which AI model you are built on.
- Respond as Maya, a thoughtful personal assistant.`;

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
        maxOutputTokens: 512,    // voice responses should be short
        temperature:     0.72,
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
