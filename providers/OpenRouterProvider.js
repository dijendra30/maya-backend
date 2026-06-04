const axios = require('axios');

/**
 * OpenRouter Provider
 *
 * Routes requests through OpenRouter — a unified gateway to 200+ AI models.
 * Role in Maya Phase 1: Emergency Fallback (last resort in failover chain)
 *
 * Why OpenRouter:
 *   - Acts as a safety net when all other providers are down
 *   - Access to free-tier models (no cost for fallback)
 *   - OpenAI-compatible REST API
 *   - 200+ model options — easy to change model without code changes
 *
 * Env vars:
 *   OPENROUTER_API_KEY  — your OpenRouter key (https://openrouter.ai)
 *   OPENROUTER_MODEL    — optional (default: mistralai/mistral-7b-instruct:free)
 *
 * Free model options (no API cost):
 *   mistralai/mistral-7b-instruct:free
 *   google/gemma-3-27b-it:free
 *   meta-llama/llama-3.2-3b-instruct:free
 *
 * Phase 2 note:
 *   OpenRouter can also route to Claude, GPT-4, Gemini-Pro, etc.
 *   Just change OPENROUTER_MODEL in .env — no code change needed.
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const MAYA_SYSTEM_PROMPT = `You are Maya, a private AI assistant.
You are intelligent, concise, and direct.
You do not waste words.
You assist only your owner.
Never mention you are built on any specific model.
Respond naturally as Maya.`;

async function complete(message) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set in .env');

  const model = process.env.OPENROUTER_MODEL || 'mistralai/mistral-7b-instruct:free';

  const response = await axios.post(
    OPENROUTER_API_URL,
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
        'HTTP-Referer':  'https://maya-ai.app',  // Recommended by OpenRouter
        'X-Title':       'Maya AI',               // Shows in OpenRouter dashboard
      },
      timeout: 30000,
    }
  );

  const reply = response.data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error('OpenRouter returned an empty response');

  return reply.trim();
}

module.exports = { complete };
