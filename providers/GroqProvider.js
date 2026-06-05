const axios = require('axios');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Voice-optimised system prompt.
 *
 * The single most important instruction is "no markdown".
 * Without it, the model uses **bold**, bullet lists, and # headers
 * which Edge TTS reads literally as "asterisk asterisk… hashtag…"
 * making the voice sound robotic regardless of voice quality.
 */
const MAYA_SYSTEM_PROMPT = `You are Maya, a private AI voice assistant.

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
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set in .env');

  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

  const response = await axios.post(
    GROQ_API_URL,
    {
      model,
      messages: [
        { role: 'system', content: MAYA_SYSTEM_PROMPT },
        { role: 'user',   content: message }
      ],
      max_tokens:  512,    // voice responses should be short
      temperature: 0.72,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      timeout: 30000,
    }
  );

  const reply = response.data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error('Groq returned an empty response');

  return reply.trim();
}

module.exports = { complete };
