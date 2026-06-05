const RouterService = require('../services/RouterService');
const TTSService    = require('../services/TTSService');

/**
 * POST /chat
 *
 * Phase 2 flow:
 *   1. Validate message
 *   2. Route to best AI provider (Gemini / Groq / Cerebras / OpenRouter)
 *   3. Convert reply to MP3 via Edge TTS
 *   4. Return { reply, provider, audioUrl }
 *
 * If Edge TTS fails for any reason, audioUrl is null in the response.
 * The Android app falls back to system TTS in that case — no crash.
 */
async function handleChat(req, res) {
  const { message } = req.body;

  // ── Validation ─────────────────────────────────────────────────────────────
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required and must be a non-empty string' });
  }

  const trimmed = message.trim();
  console.log(`\n[Chat] ← "${trimmed.substring(0, 80)}${trimmed.length > 80 ? '…' : ''}"`);

  try {
    // ── Step 1: AI response ──────────────────────────────────────────────────
    const tAI = Date.now();
    const { reply, provider } = await RouterService.route(trimmed);
    console.log(`[Chat] ✓ AI (${provider}) in ${Date.now() - tAI}ms: "${reply.substring(0, 80)}${reply.length > 80 ? '…' : ''}"`);

    // ── Step 2: Edge TTS ─────────────────────────────────────────────────────
    let audioUrl = null;

    try {
      const tTTS = Date.now();
      const filename = await TTSService.textToSpeech(reply);

      // Build absolute URL the Android app can download
      // SERVER_URL env var must be set on VPS (e.g. http://34.72.19.240:3000)
      const serverUrl = process.env.SERVER_URL
        || `http://${req.headers.host}`;

      audioUrl = `${serverUrl}/audio/${filename}`;
      console.log(`[Chat] ✓ TTS in ${Date.now() - tTTS}ms → ${audioUrl}`);

    } catch (ttsErr) {
      // TTS failure is non-fatal — Android will fall back to system TTS
      console.warn(`[Chat] ⚠ TTS failed (Android will use system TTS): ${ttsErr.message}`);
    }

    // ── Step 3: Respond ───────────────────────────────────────────────────────
    return res.json({ reply, provider, audioUrl });

  } catch (err) {
    console.error('[Chat] Router error:', err.message);
    return res.status(503).json({
      error:    'AI provider unavailable',
      detail:   err.message,
      provider: err.provider || 'unknown',
    });
  }
}

module.exports = { handleChat };
