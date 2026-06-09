/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 *  Maya AI — Chat Controller  (Core Router)
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Core Router pipeline (per spec):
 *   User → Intent Detection → Planner → Executor → Verification
 *        → Response Generator → TTS
 *
 * CRITICAL RULE:
 *   NEVER ALLOW AN AI MODEL TO PRETEND A TASK WAS DONE.
 *   Only real results may be spoken.
 *
 * Debug logging (DEBUG_ROUTING=true):
 *   Detected Intent | Plan Steps | Execution Results | Verification
 */

const ToolRouterService  = require('../services/ToolRouterService');
const PlannerService     = require('../services/PlannerService');
const StepExecutor       = require('../services/StepExecutor');
const ResponseGenerator  = require('../services/ResponseGenerator');
const VerificationGuard  = require('../services/VerificationGuard');
const TTSService         = require('../services/TTSService');

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
    screenText,
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
  console.log(`\n[ROUTER] User Input: "${trimmed}"`);

  dbg('Request', {
    message:   trimmed.slice(0, 80),
    userId:    resolvedUser,
    location:  userLocation || null,
    entities,
    hasPending: !!pendingCtx,
    hasImage:  !!(imageBase64),
  });

  try {
    const hasImage = !!(imageBase64);

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 1: INTENT DETECTION (Router)
    // ═══════════════════════════════════════════════════════════════════════
    const t1 = Date.now();
    const detection = await ToolRouterService.detectIntent(trimmed, hasImage, entities || {}, screenText);
    const detectMs  = Date.now() - t1;

    const detectedTool   = detection.tool;
    const detectedIntent = detection.intent || detection.tool;
    const mergedEntities = { ...(entities || {}), ...detection.entities };

    dbg('Stage1:Intent', {
      tool:     detectedTool,
      intent:   detectedIntent,
      entities: mergedEntities,
      tier:     detection.tier,
      detectMs,
    });

    // ── Capability Query (special case — no planner needed) ────────────────
    if (detectedTool === 'capability_query') {
      const TokenStore = require('../auth/TokenStore');
      const ToolRegistry = require('../auth/ToolRegistry');
      const authStatus = TokenStore.getAuthStatus(resolvedUser);
      const allTools   = ToolRegistry.getAllTools();
      const publicTools = allTools.filter(t => !t.requiresAuth).map(t => t.label);
      const googleTools = allTools.filter(t => t.authProvider === 'google').map(t => t.label);

      let capReply = `Here's what I can access right now. `;
      capReply    += `Always available: ${publicTools.join(', ')}. `;
      if (authStatus?.google?.connected) {
        capReply += `Google account connected (${authStatus.google.email || 'linked'}): ${googleTools.join(', ')}. `;
      } else {
        capReply += `Google tools locked (${googleTools.join(', ')}) — connect your Google account to enable these. `;
      }
      capReply += `I only access tools you have explicitly authorized.`;

      return await sendResponse(req, res, {
        reply: capReply, provider: 'capability_query', selectedTool: 'capability_query',
        toolVerified: true, voice, memCtx, t0,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 2: PLANNING
    // ═══════════════════════════════════════════════════════════════════════
    const t2   = Date.now();
    const plan = PlannerService.plan(trimmed, detectedIntent, detectedTool, mergedEntities);
    const planMs = Date.now() - t2;

    dbg('Stage2:Plan', {
      steps:              plan.steps.length,
      requiresCollection: plan.requiresCollection,
      planMs,
    });

    // ── Collection Mode: missing required fields ───────────────────────────
    if (plan.requiresCollection) {
      const genResult = await ResponseGenerator.generate({
        originalMessage: trimmed,
        memoryContext:   memCtx,
        pendingContext:  pendingCtx,
        collectionMode:  plan.collectionMode,
      });

      return await sendResponse(req, res, {
        reply: genResult.reply, provider: genResult.provider,
        selectedTool: detectedTool, toolVerified: false, voice, memCtx, t0,
        collectionMode: plan.collectionMode,
      });
    }

    // ── No tool / No steps: pure AI answer ─────────────────────────────────
    if (plan.steps.length === 0) {
      dbg('Stage2:NoSteps', 'Pure AI route');
      
      const aiContext = screenText 
        ? `${memCtx}\n\n[USER SCREEN CONTENT: ${screenText}]` 
        : memCtx;

      const genResult = await ResponseGenerator.generate({
        originalMessage: trimmed,
        memoryContext:   aiContext,
        pendingContext:  pendingCtx,
      });

      return await sendResponse(req, res, {
        reply: genResult.reply, provider: genResult.provider,
        selectedTool: null, toolVerified: false, voice, memCtx: aiContext, t0,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 3: EXECUTION
    // ═══════════════════════════════════════════════════════════════════════
    const t3 = Date.now();
    const execResult = await StepExecutor.execute(plan.steps, {
      message:           trimmed,
      location:          userLocation,
      userId:            resolvedUser,
      googleToken:       googleToken || null,
      latitude:          latitude  != null ? parseFloat(latitude)  : null,
      longitude:         longitude != null ? parseFloat(longitude) : null,
      imageBase64:       imageBase64 || null,
      extractedEntities: mergedEntities,
    });
    const execMs = Date.now() - t3;

    dbg('Stage3:Execution', {
      resultCount:  execResult.results.length,
      phoneActions: execResult.phoneActions.length,
      authRequired: execResult.authRequired,
      execMs,
    });

    // ── Auth-blocked during execution ──────────────────────────────────────
    if (execResult.authRequired) {
      const authResult = execResult.results.find(r => r.status === 'auth_blocked');
      return await sendResponse(req, res, {
        reply:         authResult?.data?.reply || 'Please connect your account to use this feature.',
        provider:      authResult?.tool || detectedTool,
        selectedTool:  authResult?.tool || detectedTool,
        toolVerified:  false,
        authRequired:  true,
        connectAction: execResult.connectAction,
        voice, memCtx, t0,
        executionPlan: execResult.results,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 4: VERIFICATION GUARD
    // ═══════════════════════════════════════════════════════════════════════
    // Already verified per-step inside StepExecutor.
    // Apply response-level guard after ResponseGenerator.

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 5: RESPONSE GENERATION
    // ═══════════════════════════════════════════════════════════════════════
    const t4 = Date.now();
    const finalAiContext = screenText 
      ? `${memCtx}\n\n[USER SCREEN CONTENT: ${screenText}]` 
      : memCtx;

    const genResult = await ResponseGenerator.generate({
      stepResults:     execResult.results,
      originalMessage: trimmed,
      memoryContext:   finalAiContext,
      pendingContext:  pendingCtx,
      selectedTool:    detectedTool,
    });
    const genMs = Date.now() - t4;

    dbg('Stage5:Response', { provider: genResult.provider, genMs, reply: genResult.reply?.slice(0, 80) });

    // ── Verification Guard on final response ───────────────────────────────
    const guard = VerificationGuard.guardResponse(genResult.reply, execResult.results);
    const finalReply = guard.safe ? genResult.reply : guard.sanitizedReply;

    // Determine phone action (first one from results, for backward compat)
    const phoneAction = execResult.phoneActions.length > 0 ? execResult.phoneActions[0] : null;

    // Determine toolVerified (all completed steps verified)
    const allVerified = execResult.results.every(r =>
      r.status === 'completed' ? r.verified : true
    );
    const anyCompleted = execResult.results.some(r => r.status === 'completed');

    return await sendResponse(req, res, {
      reply:         finalReply,
      provider:      genResult.provider,
      selectedTool:  detectedTool,
      toolVerified:  anyCompleted && allVerified,
      phoneAction,
      voice, memCtx, t0,
      executionPlan: execResult.results,
    });

  } catch (err) {
    const totalMs = Date.now() - t0;
    console.error(`[ChatCtrl] ✗ Fatal error after ${totalMs}ms: ${err.stack || err.message}`);
    dbg('FatalError', { message: err.message, totalMs });
    return res.status(503).json({ error: 'Service temporarily unavailable', detail: err.message });
  }
}

// ── Unified Response Sender ────────────────────────────────────────────────
// Handles TTS, logging, and JSON response in one place.

async function sendResponse(req, res, {
  reply, provider, selectedTool, toolVerified = false,
  phoneAction = null, authRequired = false, connectAction = null,
  collectionMode = null, executionPlan = null,
  voice, memCtx, t0,
}) {
  // Safety guard — never send empty reply
  if (!reply || !reply.trim()) {
    reply    = "I'm sorry, I couldn't process that request. Please try again.";
    provider = provider || 'fallback';
  }

  // ── TTS ──────────────────────────────────────────────────────────────────
  let audio = null, audioUrl = null, ttsError = null;
  try {
    audio    = await TTSService.textToSpeech(reply, { voice });
    audioUrl = `${getServerUrl(req)}/audio/${audio.filename}`;
  } catch (e) {
    ttsError = e.message;
    console.warn(`[ChatCtrl] TTS failed: ${e.message}`);
  }

  const totalMs = Date.now() - t0;

  // ── Logging ──────────────────────────────────────────────────────────────
  console.log(`[ROUTER] Final Response Model: ${provider}`);
  if (process.env.DEBUG_ROUTING === 'true') {
    dbg('Pipeline:Complete', {
      selectedTool, provider, toolVerified, authRequired,
      steps: executionPlan?.length || 0,
      totalMs, replyPreview: reply?.slice(0, 80),
    });
  } else {
    console.log(`[ChatCtrl] ✓ tool=${selectedTool || 'ai'} | provider=${provider} | verified=${toolVerified} | totalMs=${totalMs}`);
  }

  // ── JSON Response ────────────────────────────────────────────────────────
  return res.json({
    // ── Backward-compatible fields (unchanged from Phase 6) ────────────
    reply,
    provider,
    audioUrl,
    voice:            audio?.voice || TTSService.MAYA_VOICE,
    phoneAction,
    toolVerified,
    authRequired:     authRequired || undefined,
    connectAction:    connectAction || undefined,
    timings:          { totalMs },
    hasMemoryContext: memCtx.length > 0,
    selectedTool,
    ...(ttsError ? { ttsError } : {}),

    // ── Core Router additions ──────────────────────────────────────────
    executionPlan:    executionPlan || undefined,
    collectionMode:   collectionMode || undefined,
  });
}

module.exports = { handleChat };
