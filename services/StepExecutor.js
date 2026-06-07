/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 *  Maya AI — Step Executor  (Core Router)
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Spec flow:
 *   Intent Detection → Planner → EXECUTOR → Response Generator → TTS
 *
 * Executes an ordered array of steps from the Planner.
 *
 * Rules:
 *   - Server steps: execute via ToolRouterService.executeTool()
 *   - Device steps: package as phoneActions for Android
 *   - Each step is verified before marking complete
 *   - NEVER claim success without tool confirmation
 *   - Stop on critical failure, continue on optional steps
 *   - Synchronous: await each step before proceeding
 */

const ToolRouterService = require('./ToolRouterService');
const PermissionGuard   = require('../auth/PermissionGuard');
const VerificationGuard = require('./VerificationGuard');

// ── Debug Logger ───────────────────────────────────────────────────────────
function dbg(label, data) {
  if (process.env.DEBUG_ROUTING !== 'true') return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[StepExec:${ts}] ${label}`, typeof data === 'object' ? JSON.stringify(data) : (data || ''));
}

// ── Device-side intents (not executed on server) ───────────────────────────
const DEVICE_INTENTS = new Set([
  'send_message', 'call_contact', 'open_app', 'device_control',
]);

// ── Main Executor ──────────────────────────────────────────────────────────

/**
 * Execute an ordered array of steps.
 *
 * @param {Array} steps       - Step array from PlannerService.plan()
 * @param {object} context    - Execution context
 * @param {string} context.message      - Original user message
 * @param {string} context.location     - GPS city name
 * @param {string} context.userId       - User ID
 * @param {string} context.googleToken  - Google OAuth token
 * @param {number} context.latitude     - GPS latitude
 * @param {number} context.longitude    - GPS longitude
 * @param {string} context.imageBase64  - Base64 image for vision
 * @param {object} context.extractedEntities - Pre-extracted entities
 * @returns {Promise<{ results: Array, phoneActions: Array, authRequired: boolean, connectAction: object|null }>}
 */
async function execute(steps, context = {}) {
  const t0 = Date.now();
  const results      = [];
  const phoneActions = [];
  let   authRequired  = false;
  let   connectAction = null;

  dbg('Start', { stepCount: steps.length, userId: context.userId });

  for (const step of steps) {
    const stepT0 = Date.now();

    dbg('Step', { index: step.stepIndex, tool: step.tool, action: step.action, executedOn: step.executedOn });

    // ── Device-side step: package for Android ──────────────────────────────
    if (step.executedOn === 'device' || DEVICE_INTENTS.has(step.tool)) {
      const phoneAction = buildPhoneAction(step);
      if (phoneAction) phoneActions.push(phoneAction);

      results.push({
        stepIndex: step.stepIndex,
        tool:      step.tool,
        action:    step.action,
        status:    'pending_device',
        verified:  false,
        data:      { reply: phoneAction?.confirmText || `Performing ${step.action} on your device.` },
        elapsedMs: Date.now() - stepT0,
      });

      dbg('DeviceStep', { index: step.stepIndex, action: phoneAction?.type });
      continue;
    }

    // ── Server-side step: permission check ─────────────────────────────────
    const permission = await PermissionGuard.guard(
      step.tool,
      context.userId || 'default',
      context.googleToken || null
    );

    if (!permission.allowed) {
      authRequired  = true;
      connectAction = permission.connectAction;

      results.push({
        stepIndex: step.stepIndex,
        tool:      step.tool,
        action:    step.action,
        status:    'auth_blocked',
        verified:  false,
        data:      { reply: permission.message },
        elapsedMs: Date.now() - stepT0,
      });

      dbg('AuthBlocked', { index: step.stepIndex, tool: step.tool, reason: permission.reason });
      // Auth block is critical — stop execution
      break;
    }

    // ── Server-side step: execute tool ─────────────────────────────────────
    try {
      const toolOptions = {
        userId:            context.userId,
        googleToken:       context.googleToken,
        latitude:          context.latitude,
        longitude:         context.longitude,
        imageBase64:       context.imageBase64,
        extractedEntities: { ...context.extractedEntities, ...step.params },
        _resolvedToken:    permission.token,
      };

      const toolResult = await ToolRouterService.executeTool(
        step.tool,
        step.params.rawMessage || context.message,
        context.location || '',
        toolOptions
      );

      const stepElapsed = Date.now() - stepT0;

      if (!toolResult || !toolResult.reply) {
        // Tool returned empty — mark failed
        results.push({
          stepIndex: step.stepIndex,
          tool:      step.tool,
          action:    step.action,
          status:    'failed',
          verified:  false,
          data:      { reply: `I tried to use ${step.tool} but it returned no data.` },
          elapsedMs: stepElapsed,
        });

        dbg('EmptyResult', { index: step.stepIndex, tool: step.tool });
        continue;
      }

      // ── Verify result ───────────────────────────────────────────────────
      const verification = VerificationGuard.verify(step.tool, toolResult);

      results.push({
        stepIndex:   step.stepIndex,
        tool:        step.tool,
        action:      step.action,
        status:      verification.verified ? 'completed' : 'unverified',
        verified:    verification.verified,
        data:        toolResult,
        elapsedMs:   stepElapsed,
        evidence:    verification.evidence,
      });

      // Collect phoneActions from tool results
      if (toolResult.phoneAction) {
        phoneActions.push(toolResult.phoneAction);
      }

      dbg('StepComplete', {
        index:    step.stepIndex,
        tool:     step.tool,
        verified: verification.verified,
        elapsedMs: stepElapsed,
      });

    } catch (err) {
      const stepElapsed = Date.now() - stepT0;
      console.error(`[StepExec] ✗ Step ${step.stepIndex} (${step.tool}) failed: ${err.message}`);

      const is401 = err.response?.status === 401 || err.message?.includes('401');

      if (is401) {
        authRequired  = true;
        connectAction = PermissionGuard.buildConnectAction(permission.provider);
      }

      results.push({
        stepIndex: step.stepIndex,
        tool:      step.tool,
        action:    step.action,
        status:    'failed',
        verified:  false,
        data: {
          reply: is401
            ? `My access to ${step.tool} has expired. Please reconnect your account.`
            : `I tried ${step.tool} but encountered an error: ${err.message?.slice(0, 100) || 'unknown'}.`,
        },
        elapsedMs: stepElapsed,
      });

      // Critical failure — stop execution chain
      if (is401) break;
    }
  }

  const totalMs = Date.now() - t0;
  dbg('Complete', { totalSteps: steps.length, completed: results.length, totalMs });

  return { results, phoneActions, authRequired, connectAction };
}

// ── Build phoneAction for device-side steps ────────────────────────────────
function buildPhoneAction(step) {
  switch (step.tool) {
    case 'open_app':
      return {
        type:        'OPEN_APP',
        package:     step.params.package || null,
        app:         step.params.app || null,
        confirmText: `Opening ${step.params.app || 'the app'}.`,
      };

    case 'send_message':
      return {
        type:        'SEND_MESSAGE',
        recipient:   step.params.recipient || null,
        message:     step.params.message || null,
        confirmText: step.params.message
          ? `Sending message to ${step.params.recipient || 'contact'}.`
          : `Opening message to ${step.params.recipient || 'contact'}.`,
      };

    case 'call_contact':
      return {
        type:        'CALL',
        recipient:   step.params.recipient || null,
        confirmText: `Calling ${step.params.recipient || 'contact'}.`,
      };

    case 'device_control':
      return {
        type:        'DEVICE_ACTION',
        action:      step.action,
        params:      step.params,
        confirmText: `Performing ${step.action} on your device.`,
      };

    default:
      return null;
  }
}

module.exports = { execute };
