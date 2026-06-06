const express = require('express');
const router  = express.Router();
const TTSService = require('../services/TTSService');

function getServerUrl(req) {
  const configured = process.env.SERVER_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

/**
 * POST /tts
 * Body:   { "text": "...", "voice": "en-US-AriaNeural" }
 * Return: { "audioUrl": "..." }
 *
 * Lightweight endpoint used by the Android app to voice
 * short local confirmations (phone actions) without AI routing.
 */
router.post('/tts', async (req, res) => {
  const { text, voice } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }
  try {
    const audio    = await TTSService.textToSpeech(text.trim(), { voice });
    const audioUrl = `${getServerUrl(req)}/audio/${audio.filename}`;
    return res.json({ audioUrl, voice: audio.voice });
  } catch (err) {
    return res.status(503).json({ error: 'TTS failed', detail: err.message });
  }
});

module.exports = router;
