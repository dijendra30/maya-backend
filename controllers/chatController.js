const RouterService     = require('../services/RouterService');
const ToolRouterService = require('../services/ToolRouterService');
const TTSService        = require('../services/TTSService');

function getServerUrl(req) {
  const c = process.env.SERVER_URL;
  if (c) return c.replace(/\/+$/, '');
  return `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
}

async function handleChat(req, res) {
  const {
    message, voice, context,
    location,                   // Phase 4: city name
    googleToken,                // Phase 4: Google OAuth token
    latitude, longitude,        // Phase 4: GPS coordinates
    imageBase64,                // Phase 4: Vision — base64 image
  } = req.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const trimmed      = message.trim();
  const memCtx       = typeof context === 'string' ? context.trim() : '';
  const userLocation = typeof location === 'string' ? location.trim() : '';
  const t0           = Date.now();

  try {
    const t1 = Date.now();
    let reply, provider, phoneAction = null;

    const toolResult = await ToolRouterService.route(trimmed, userLocation, {
      googleToken: googleToken || null,
      latitude:    latitude   != null ? parseFloat(latitude)   : null,
      longitude:   longitude  != null ? parseFloat(longitude)  : null,
      imageBase64: imageBase64 || null,
    });

    if (toolResult && !toolResult.toolFailed) {
      reply       = toolResult.reply;
      provider    = toolResult.toolUsed;
      phoneAction = toolResult.phoneAction || null;
    } else {
      if (toolResult?.toolFailed) console.log(`[Chat] Tool failed for ${toolResult.toolUsed}, using AI`);
      const ai = await RouterService.route(trimmed, memCtx);
      reply    = ai.reply;
      provider = ai.provider;
    }

    const aiMs = Date.now() - t1;

    // TTS
    let audio = null, audioUrl = null, ttsError = null;
    try {
      audio    = await TTSService.textToSpeech(reply, { voice });
      audioUrl = `${getServerUrl(req)}/audio/${audio.filename}`;
    } catch (e) {
      ttsError = e.message;
    }

    return res.json({
      reply, provider, audioUrl,
      voice:           audio?.voice || TTSService.MAYA_VOICE,
      phoneAction,
      timings:         { aiMs, ttsMs: audio?.durationMs || null, totalMs: Date.now() - t0 },
      hasMemoryContext: memCtx.length > 0,
      ...(ttsError ? { ttsError } : {}),
    });

  } catch (err) {
    return res.status(503).json({ error: 'Provider unavailable', detail: err.message });
  }
}

module.exports = { handleChat };
