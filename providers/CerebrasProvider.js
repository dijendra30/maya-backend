const axios = require('axios');

/**
 * Cerebras Provider
 *
 * Uses Cerebras Cloud API — ultra-fast inference on Wafer-Scale Engine.
 * Role in Maya Phase 1: Ultra Fast Fallback (3rd in failover chain)
 *
 * Why Cerebras:
 *   - Fastest token generation available (1000+ tokens/sec)
 *   - OpenAI-compatible REST API
 *   - Excellent for quick fallback with minimal latency
 *
 * Env vars:
 *   CEREBRAS_API_KEY  — your Cerebras key (https://cloud.cerebras.ai)
 *   CEREBRAS_MODEL    — optional (default: llama3.1-8b)
 *
 * Phase 2 note:
 *   Swap model to llama3.1-70b for higher quality when needed.
 */

const CEREBRAS_API_URL = 'https://api.cerebras.ai/v1/chat/completions';

const MAYA_SYSTEM_PROMPT = `You are Maya, a private AI assistant.
You are intelligent, concise, and direct.
You do not waste words.
You assist only your owner.
Never mention you are built on any specific model.
Respond naturally as Maya.`;

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
      max_tokens:  1024,
      temperature: 0.7,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      timeout: 20000, // Cerebras is fast; 20 s is generous
    }
  );

  const reply = response.data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error('Cerebras returned an empty response');

  return reply.trim();
}

module.exports = { complete };
