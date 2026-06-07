/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 *  Maya AI — Chat Controller  (Phase 6 — Production Routing)
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Full pipeline (per spec):
 *   User → RouterService (Gemini Flash → Groq → OpenRouter)
 *        → Intent Detection → Entity Extraction → Task Planning
 *        → Tool Selection → Execution (synchronous) → Verification → Response
 *
 * Debug logging (DEBUG_ROUTING=true):
 *   Detected Intent | Extracted Entities | Selected Tool
 *   Execution Result | Execution Time | Selected AI Provider | Failover Events
 */

const RouterService     = require('../services/RouterService');
const ToolRouterService = require('../services/ToolRouterService');
const TTSService        = require('../services/TTSService');

function getServerUrl(req) {
  const c = process.env.SERVER_URL;
  if (c) return c.replace(/\/+$/, '');
  return `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
}

function dbg(label, data) {
  if (process.env.DEBUG_ROUTING !== 'true') return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[ChatCtrl:${ts}] ${label}`, typeof data === 'object' ? JSON.stringify(data) : (data || ''));
}

async function handleChat(req, res) {
  const {
    message,
    voice,
    context,
    location,
    googleToken,
    latitude,
    longitude,
    imageBase64,
    userId,
    pendingContext,
    extractedEntities,
  } = req.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const trimmed      = message.trim();
  const memCtx       = typeof context === 'string' ? context.trim() : '';
  const userLocation = typeof location === 'string' ? location.trim() : '';
  const resolvedUser = typeof userId === 'string' && userId.trim() ? userId.trim() : 'default';
  const pendingCtx   = typeof pendingContext === 'string' ? pendingContext.trim() : '';
  const entities     = (typeof extractedEntities === 'object' && extractedEntities !== null)
    ? extractedEntities : null;

  const t0 = Date.now();

  dbg('Request', {
    message:   trimmed.slice(0, 80),
    userId:    resolvedUser,
    location:  userLocation || null,
    entities,
    hasPending: !!pendingCtx,
    hasImage:  !!(imageBase64),
  });

  try {
    let reply, provider, phoneAction = null, authRequired = false, connectAction = null;
    let toolVerified = false;
    let selectedTool = null;

    const t1 = Date.now();

    // ── Step 1: Tool Routing Pipeline ───────────────────────────────────────
    // Tool execution is FULLY SYNCHRONOUS from user's perspective.
    // Maya NEVER responds before the tool finishes.
    const toolResult = await ToolRouterService.route(trimmed, userLocation, {
      userId:            resolvedUser,
      googleToken:       googleToken || null,
      latitude:          latitude  != null ? parseFloat(latitude)  : null,
      longitude:         longitude != null ? parseFloat(longitude) : null,
      imageBase64:       imageBase64 || null,
      extractedEntities: entities,
    });

    const toolMs = Date.now() - t1;

    // ── Step 2: Route Result Handling ───────────────────────────────────────
    if (toolResult) {
      selectedTool = toolResult.toolUsed;

      if (toolResult.authRequired) {
        // Auth-blocked — return prompt immediately, NO AI fallback
        reply         = toolResult.reply;
        provider      = toolResult.toolUsed;
        authRequired  = true;
        connectAction = toolResult.connectAction || null;
        phoneAction   = null;
        toolVerified  = false;

        dbg('AuthBlocked', { tool: selectedTool, provider: connectAction?.provider });

      } else if (!toolResult.toolFailed) {
        // Tool succeeded with real data
        reply        = toolResult.reply;
        provider     = toolResult.toolUsed;
        phoneAction  = toolResult.phoneAction || null;
        toolVerified = toolResult.toolVerified || false;

        dbg('ToolSuccess', { tool: selectedTool, toolMs, verified: toolVerified, reply: reply?.slice(0,80) });

      } else {
        // Tool failed — AI fallback with slot context
        dbg('ToolFailed', { tool: selectedTool, toolMs });
        console.log(`[ChatCtrl] Tool failed for ${toolResult.toolUsed}, using AI fallback`);

        const t2  = Date.now();
        const ai  = await RouterService.route(trimmed, memCtx, pendingCtx);
        const aiMs2 = Date.now() - t2;

        reply    = ai.reply;
        provider = ai.provider;
        dbg('AIFallback', { provider: ai.provider, aiMs: aiMs2 });
      }
    } else {
      // No tool matched — pure AI answer
      dbg('NoTool', 'Pure AI route');

      const t2  = Date.now();
      const ai  = await RouterService.route(trimmed, memCtx, pendingCtx);
      const aiMs2 = Date.now() - t2;

      reply    = ai.reply;
      provider = ai.provider;
      dbg('AIAnswer', { provider: ai.provider, aiMs: aiMs2 });
    }

    const aiMs = Date.now() - t1;

    // ── Step 3: Safety Guard — never send empty reply ───────────────────────
    if (!reply || !reply.trim()) {
      reply    = "I'm sorry, I couldn't process that request. Please try again.";
      provider = provider || 'fallback';
    }

    // ── Step 4: TTS (non-blocking — doesn't affect routing) ────────────────
    let audio = null, audioUrl = null, ttsError = null;
    try {
      audio    = await TTSService.textToSpeech(reply, { voice });
      audioUrl = `${getServerUrl(req)}/audio/${audio.filename}`;
    } catch (e) {
      ttsError = e.message;
      console.warn(`[ChatCtrl] TTS failed: ${e.message}`);
    }

    const totalMs = Date.now() - t0;

    // ── Step 5: Debug log full pipeline result ──────────────────────────────
    if (process.env.DEBUG_ROUTING === 'true') {
      dbg('Pipeline:Complete', {
        selectedTool,
        provider,
        toolVerified,
        authRequired,
        totalMs,
        replyPreview: reply?.slice(0, 80),
      });
    } else {
      console.log(`[ChatCtrl] ✓ tool=${selectedTool || 'ai'} | provider=${provider} | verified=${toolVerified} | totalMs=${totalMs}`);
    }

    return res.json({
      reply,
      provider,
      audioUrl,
      voice:            audio?.voice || TTSService.MAYA_VOICE,
      phoneAction,
      toolVerified,
      authRequired:     authRequired || undefined,
      connectAction:    connectAction || undefined,
      timings:          { aiMs, ttsMs: audio?.durationMs || null, totalMs },
      hasMemoryContext: memCtx.length > 0,
      selectedTool,
      ...(ttsError ? { ttsError } : {}),
    });

  } catch (err) {
    const totalMs = Date.now() - t0;
    console.error(`[ChatCtrl] ✗ Fatal error after ${totalMs}ms: ${err.stack || err.message}`);
    dbg('FatalError', { message: err.message, totalMs });
    return res.status(503).json({ error: 'Service temporarily unavailable', detail: err.message });
  }
}

module.exports = { handleChat };
