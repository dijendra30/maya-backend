const axios = require('axios');

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

const BASE_SYSTEM_PROMPT = `You are Maya, a private AI voice assistant.

CRITICAL — VOICE OUTPUT RULES (follow these above everything else):
- Respond in plain, spoken English only.
- NEVER use markdown: no asterisks, no bold, no italic, no bullet points, no numbered lists, no headers, no code fences, no backticks.
- Write as if you are speaking out loud, not typing a document.
- Use natural, flowing sentences separated by commas or periods.
- If listing things, say them conversationally: "First... then... and finally..."
- Keep answers concise — 1 to 3 sentences when possible.
- If a longer answer is needed, use short paragraphs with natural transitions.
- If the user's preferred language is Hindi, respond in Hindi (Devanagari script or Hinglish as appropriate).

PERSONA:
- You are intelligent, warm, and direct.
- You assist only your owner. Address them by name if you know it.
- Never reveal which AI model you are built on.
- Respond as Maya, a thoughtful personal assistant who genuinely knows the user.
- Use the memory context silently to personalize your responses without mentioning that you are reading from context.`;

async function complete(message, context = '', pendingContext = '') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env');

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Phase 3: prepend long-term memory context
  const systemText = context
    ? `${context}\n\n${BASE_SYSTEM_PROMPT}`
    : BASE_SYSTEM_PROMPT;

  // Phase 4: inject multi-turn slot context so Maya can continue the action
  const finalSystem = pendingContext
    ? `${systemText}\n\nACTIVE SLOT CONTEXT (internal only, never repeat to user):\n${pendingContext}`
    : systemText;

  const response = await axios.post(
    url,
    {
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
