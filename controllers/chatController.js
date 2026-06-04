const RouterService = require('../services/RouterService');

/**
 * POST /chat
 *
 * Validates the incoming request, delegates to RouterService,
 * and returns the structured response to the Android app.
 */
async function handleChat(req, res) {
  const { message } = req.body;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required and must be a non-empty string' });
  }

  const trimmed = message.trim();
  console.log(`[Chat] Received: "${trimmed.substring(0, 80)}${trimmed.length > 80 ? '...' : ''}"`);

  try {
    // ── Route to best AI provider ─────────────────────────────────────────
    const { reply, provider } = await RouterService.route(trimmed);

    console.log(`[Chat] Response via ${provider}: "${reply.substring(0, 80)}${reply.length > 80 ? '...' : ''}"`);

    return res.json({ reply, provider });

  } catch (err) {
    console.error('[Chat] Router error:', err.message);
    return res.status(503).json({
      error:    'AI provider unavailable',
      detail:   err.message,
      provider: err.provider || 'unknown'
    });
  }
}

module.exports = { handleChat };
