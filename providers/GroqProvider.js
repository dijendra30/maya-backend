const axios = require('axios');

/**
 * Groq Provider
 *
 * Uses the Groq inference API — extremely fast LLM inference.
 * Default model: llama-3.1-8b-instant (best speed/quality balance).
 *
 * Env vars required:
 *   GROQ_API_KEY   — your Groq API key (https://console.groq.com)
 *   GROQ_MODEL     — optional override (default: llama-3.1-8b-instant)
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Maya's system persona — short and sharp
const MAYA_SYSTEM_PROMPT = `You are Maya, a private AI assistant. 
You are intelligent, concise, and direct. 
You do not waste words. 
You assist only your owner. 
Never mention you are built on any specific model.
Respond naturally as Maya.`;

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
      max_tokens:  1024,
      temperature: 0.7,
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
