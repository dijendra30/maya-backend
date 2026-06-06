/**
 * Maya AI — Permission Guard
 *
 * Middleware-style guard that checks tool permissions before execution.
 * Verifies: installed → requiresAuth → authenticated.
 *
 * Returns either { allowed: true, token } or { allowed: false, reason, provider }.
 * Maya should NEVER execute an auth-required tool without passing this guard.
 */

const ToolRegistry  = require('./ToolRegistry');
const TokenStore    = require('./TokenStore');
const TokenRefresh  = require('./TokenRefreshService');

/**
 * Check if a tool can be used by a given user.
 *
 * @param {string} toolId   – e.g. 'gmail', 'weather', 'calendar'
 * @param {string} userId   – device/user identifier
 * @param {string} [incomingToken] – token sent directly from Android (fallback path)
 * @returns {Promise<{allowed, token, reason, provider, toolLabel}>}
 */
async function checkPermission(toolId, userId, incomingToken = null) {
  const tool = ToolRegistry.getTool(toolId);

  // Unknown tool
  if (!tool) {
    return {
      allowed:   false,
      reason:    'unknown_tool',
      toolLabel: toolId,
      provider:  null,
      token:     null,
      message:   `I don't have a tool called "${toolId}".`,
    };
  }

  // Tool not installed
  if (!tool.installed) {
    return {
      allowed:   false,
      reason:    'not_installed',
      toolLabel: tool.label,
      provider:  null,
      token:     null,
      message:   `The ${tool.label} tool is not installed in this instance of Maya.`,
    };
  }

  // No auth required — always allowed
  if (!tool.requiresAuth) {
    return { allowed: true, token: null, toolLabel: tool.label, provider: 'none' };
  }

  // Auth required — check server-side token first
  const provider = tool.authProvider;

  if (userId) {
    const serverToken = await TokenRefresh.getValidToken(userId, provider);
    if (serverToken) {
      return { allowed: true, token: serverToken, toolLabel: tool.label, provider };
    }
  }

  // Fallback: Android sent the token directly (legacy path)
  if (incomingToken) {
    console.log(`[PermissionGuard] Using client-provided token for ${toolId}`);
    return { allowed: true, token: incomingToken, toolLabel: tool.label, provider };
  }

  // Not authenticated
  return {
    allowed:   false,
    reason:    'not_authenticated',
    toolLabel: tool.label,
    provider,
    token:     null,
    message:   buildAuthMessage(tool),
    connectAction: buildConnectAction(provider),
  };
}

/**
 * Build a natural-language auth prompt for Maya to speak.
 */
function buildAuthMessage(tool) {
  const providerName = { google: 'Google account', spotify: 'Spotify account' }[tool.authProvider] || 'account';
  return `I can access ${tool.label} after you connect your ${providerName}. Would you like to connect now?`;
}

/**
 * Build a structured connect action Android can render as a button.
 */
function buildConnectAction(provider) {
  const actions = {
    google:  { type: 'CONNECT_ACCOUNT', provider: 'google',  label: 'Connect Google Account' },
    spotify: { type: 'CONNECT_ACCOUNT', provider: 'spotify', label: 'Connect Spotify Account' },
  };
  return actions[provider] || null;
}

/**
 * Bulk check: given a tool name detected from a message,
 * returns a permission result with a structured auth prompt if blocked.
 *
 * This is the main function called by ToolRouterService.
 *
 * @param {string} toolId
 * @param {string} userId
 * @param {string} [incomingToken]
 * @returns {Promise<PermissionResult>}
 */
async function guard(toolId, userId, incomingToken = null) {
  return checkPermission(toolId, userId, incomingToken);
}

module.exports = { guard, checkPermission, buildAuthMessage, buildConnectAction };
