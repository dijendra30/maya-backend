const axios = require('axios');

/**
 * Ollama Provider
 *
 * Calls a locally-running Ollama instance — fully offline, fully private.
 * Best for coding tasks (Qwen2.5-Coder, DeepSeek-Coder) and sensitive queries.
 *
 * Setup:
 *   1. Install Ollama: https://ollama.com
 *   2. Pull a model:   ollama pull llama3.2
 *   3. Start Ollama:   ollama serve
 *
 * Env vars:
 *   OLLAMA_BASE_URL  — default: http://localhost:11434
 *   OLLAMA_MODEL     — default: llama3.2
 *                      Try: qwen2.5-coder:7b  for coding tasks
 *                           deepseek-r1:8b    for reasoning
 */

const MAYA_SYSTEM_PROMPT = `You are Maya, a private AI assistant.
You are intelligent, concise, and direct.
You do not waste words.
You assist only your owner.
Never mention you are built on any specific model.
Respond naturally as Maya.`;

async function complete(message) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model   = process.env.OLLAMA_MODEL    || 'llama3.2';
  const url     = `${baseUrl}/api/chat`;

  const response = await axios.post(
    url,
    {
      model,
      stream: false,   // get the full response at once
      messages: [
        { role: 'system', content: MAYA_SYSTEM_PROMPT },
        { role: 'user',   content: message }
      ],
      options: {
        temperature: 0.7,
        num_predict: 1024,
      }
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,  // local models can be slower
    }
  );

  const reply = response.data?.message?.content;
  if (!reply) throw new Error('Ollama returned an empty response');

  return reply.trim();
}

module.exports = { complete };
