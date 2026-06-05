const RouterService = require('../services/RouterService');
const TTSService = require('../services/TTSService');

/**
 * Maya Phase 3 — Chat Controller
 *
 * Changes from Phase 2:
 *   • Accepts `context` field from request body
 *   • Forwards context to RouterService.route(message, context)
 *   • Context is the full memory block assembled by MemoryManager on the device
 */

function getServerUrl(req) {
  const configured = process.env.SERVER_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.get('host');
  return `${protocol}://${host}`;
}

async function handleChat(req, res) {
  const { message, voice, context } = req.body || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required and must be a non-empty string' });
  }

  const trimmed   = message.trim();
  const memCtx    = typeof context === 'string' ? context.trim() : '';
  const requestStartedAt = Date.now();

  try {
    const aiStartedAt = Date.now();

    // Phase 3: pass memory context to router → provider → system prompt
    const { reply, provider } = await RouterService.route(trimmed, memCtx);

    const aiDurationMs = Date.now() - aiStartedAt;

    let audio    = null;
    let audioUrl = null;
    let ttsError = null;

    try {
      audio    = await TTSService.textToSpeech(reply, { voice });
      audioUrl = `${getServerUrl(req)}/audio/${audio.filename}`;
    } catch (error) {
      ttsError = error.message;
      console.warn(`[Chat] TTS failed: ${error.message}`);
    }

    return res.json({
      reply,
      provider,
      audioUrl,
      voice: audio?.voice || TTSService.MAYA_VOICE,
      timings: {
        aiMs:    aiDurationMs,
        ttsMs:   audio?.durationMs || null,
        totalMs: Date.now() - requestStartedAt,
      },
      hasMemoryContext: memCtx.length > 0,   // useful for debugging
      ...(ttsError ? { ttsError } : {}),
    });

  } catch (error) {
    console.error(`[Chat] Provider error: ${error.message}`);
    return res.status(503).json({
      error:    'AI provider unavailable',
      detail:   error.message,
      provider: error.provider || 'unknown',
    });
  }
}

module.exports = { handleChat };
