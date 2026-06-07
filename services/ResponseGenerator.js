/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 *  Maya AI — Response Generator  (Core Router)
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Spec flow:
 *   Intent Detection → Planner → Executor → RESPONSE GENERATOR → TTS
 *
 * CRITICAL RULE (from spec):
 *   NEVER ALLOW AN AI MODEL TO PRETEND A TASK WAS DONE.
 *   Only real results may be spoken.
 *
 * Responsibilities:
 *   - Take verified tool results → generate user-facing reply
 *   - Knowledge queries → route through AI provider chain
 *   - Wikipedia data → use as context for AI-generated spoken answer
 *   - Collection mode → return the follow-up question
 *   - Failed tools → honestly report failure
 *
 * This module NEVER executes tools. It only transforms results into speech.
 */

const RouterService = require('./RouterService');

// ── Debug Logger ───────────────────────────────────────────────────────────
function dbg(label, data) {
  if (process.env.DEBUG_ROUTING !== 'true') return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[ResponseGen:${ts}] ${label}`, typeof data === 'object' ? JSON.stringify(data) : (data || ''));
}

// ── Main Entry ─────────────────────────────────────────────────────────────

/**
 * Generate the final user-facing reply from execution results.
 *
 * @param {object} params
 * @param {Array}  params.stepResults     - Results from StepExecutor
 * @param {string} params.originalMessage - User's original message
 * @param {string} params.memoryContext   - Memory/conversation context
 * @param {string} params.pendingContext  - Multi-turn slot context
 * @param {object} params.collectionMode  - If set, we're in collection mode
 * @param {string} params.selectedTool    - The primary tool that was used
 * @returns {Promise<{ reply: string, provider: string }>}
 */
async function generate({
  stepResults = [],
  originalMessage,
  memoryContext = '',
  pendingContext = '',
  collectionMode = null,
  selectedTool = null,
}) {
  const t0 = Date.now();

  // ── Collection Mode: return the follow-up question ───────────────────────
  if (collectionMode) {
    dbg('CollectionMode', collectionMode);
    return {
      reply:    collectionMode.prompt,
      provider: 'planner',
    };
  }

  // ── No steps / No tool: pure AI answer ───────────────────────────────────
  if (!stepResults || stepResults.length === 0) {
    dbg('PureAI', 'No tool results, routing to AI');
    const ai = await RouterService.route(originalMessage, memoryContext, pendingContext);
    dbg('PureAI:Result', { provider: ai.provider, elapsedMs: Date.now() - t0 });
    return ai;
  }

  // ── Process step results ─────────────────────────────────────────────────
  const successResults = stepResults.filter(r => r.status === 'completed' && r.verified);
  const failedResults  = stepResults.filter(r => r.status === 'failed');
  const pendingResults = stepResults.filter(r => r.status === 'pending_device');

  dbg('Results', {
    total:    stepResults.length,
    success:  successResults.length,
    failed:   failedResults.length,
    pending:  pendingResults.length,
  });

  // ── All steps failed ────────────────────────────────────────────────────
  if (successResults.length === 0 && pendingResults.length === 0) {
    // If tool failed, try AI fallback
    if (failedResults.length > 0) {
      const toolNames = failedResults.map(r => r.tool).join(', ');
      dbg('AllFailed', { tools: toolNames });

      try {
        const ai = await RouterService.route(originalMessage, memoryContext, pendingContext);
        return ai;
      } catch {
        return {
          reply:    `I tried to use ${toolNames} but encountered an error. Please try again.`,
          provider: 'fallback',
        };
      }
    }

    // No results at all — AI answer
    const ai = await RouterService.route(originalMessage, memoryContext, pendingContext);
    return ai;
  }

  // ── Wikipedia special case: data source for AI ───────────────────────────
  const wikiResult = successResults.find(r => r.tool === 'wikipedia');
  if (wikiResult) {
    const wikiContext = `WIKIPEDIA DATA:\n${wikiResult.data.reply}\n\nAnswer the user's question using ONLY this data, in natural spoken language.`;
    dbg('WikipediaAsContext', { chars: wikiContext.length });
    const ai = await RouterService.route(originalMessage, wikiContext, pendingContext);
    return { reply: ai.reply, provider: ai.provider };
  }

  // ── Single successful tool result ────────────────────────────────────────
  if (successResults.length === 1 && pendingResults.length === 0) {
    const result = successResults[0];
    return {
      reply:    result.data.reply,
      provider: result.tool,
    };
  }

  // ── Multiple results: combine ────────────────────────────────────────────
  const parts = [];

  for (const result of successResults) {
    if (result.data.reply) parts.push(result.data.reply);
  }

  for (const result of pendingResults) {
    if (result.data?.reply) parts.push(result.data.reply);
  }

  for (const result of failedResults) {
    parts.push(`I couldn't complete the ${result.tool} action.`);
  }

  return {
    reply:    parts.join(' '),
    provider: successResults[0]?.tool || 'multi',
  };
}

module.exports = { generate };
