/**
 * Maya AI — OAuth Token Store
 *
 * In-memory + filesystem persistence for OAuth tokens.
 * Stores access_token, refresh_token, expiry_time per user per provider.
 *
 * For production: replace file-based store with Redis or a database.
 *
 * Structure:
 *   tokenStore[userId][provider] = { access_token, refresh_token, expiry_time, scopes, email }
 */

const fs   = require('fs');
const path = require('path');

const STORE_DIR  = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(STORE_DIR, 'oauth_tokens.json');

// Ensure data directory exists
if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });

// In-memory cache
let tokenStore = {};

// ── Load from disk ────────────────────────────────────────────────────────────
function loadFromDisk() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      tokenStore = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('[TokenStore] Could not load tokens from disk:', e.message);
    tokenStore = {};
  }
}

function saveToDisk() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(tokenStore, null, 2), 'utf8');
  } catch (e) {
    console.warn('[TokenStore] Could not save tokens to disk:', e.message);
  }
}

loadFromDisk();

// ── Core Operations ───────────────────────────────────────────────────────────

/**
 * Save or update an OAuth token for a user.
 *
 * @param {string} userId
 * @param {string} provider  – 'google' | 'spotify'
 * @param {object} tokenData – { access_token, refresh_token?, expires_in?, email?, scopes? }
 */
function saveToken(userId, provider, tokenData) {
  if (!tokenStore[userId]) tokenStore[userId] = {};

  const expiresIn = tokenData.expires_in || 3600;
  tokenStore[userId][provider] = {
    access_token:  tokenData.access_token,
    refresh_token: tokenData.refresh_token || tokenStore[userId][provider]?.refresh_token || null,
    expiry_time:   Date.now() + expiresIn * 1000,
    scopes:        tokenData.scope || tokenData.scopes || '',
    email:         tokenData.email || tokenStore[userId][provider]?.email || null,
    connected_at:  tokenStore[userId][provider]?.connected_at || new Date().toISOString(),
    last_used:     new Date().toISOString(),
  };

  saveToDisk();
  console.log(`[TokenStore] Saved ${provider} token for user ${userId}`);
}

/**
 * Get stored token data for a user + provider.
 * Returns null if not found or expired with no refresh token.
 *
 * @param {string} userId
 * @param {string} provider
 * @returns {object|null}
 */
function getToken(userId, provider) {
  const data = tokenStore[userId]?.[provider];
  if (!data) return null;
  return data;
}

/**
 * Get a valid access_token. Returns null if not authenticated.
 * Does NOT auto-refresh (refresh is handled by RefreshService).
 *
 * @param {string} userId
 * @param {string} provider
 * @returns {string|null}
 */
function getAccessToken(userId, provider) {
  const data = getToken(userId, provider);
  if (!data) return null;
  // Return token even if possibly expired — caller should handle 401
  return data.access_token || null;
}

/**
 * Check if a user has a valid (non-expired) token for a provider.
 *
 * @param {string} userId
 * @param {string} provider
 * @returns {boolean}
 */
function isAuthenticated(userId, provider) {
  const data = getToken(userId, provider);
  if (!data || !data.access_token) return false;
  // Allow 60s grace period
  return Date.now() < (data.expiry_time - 60_000);
}

/**
 * Update last_used timestamp.
 *
 * @param {string} userId
 * @param {string} provider
 */
function touchLastUsed(userId, provider) {
  if (tokenStore[userId]?.[provider]) {
    tokenStore[userId][provider].last_used = new Date().toISOString();
    saveToDisk();
  }
}

/**
 * Remove all tokens for a user + provider (logout/disconnect).
 *
 * @param {string} userId
 * @param {string} provider
 */
function removeToken(userId, provider) {
  if (tokenStore[userId]?.[provider]) {
    delete tokenStore[userId][provider];
    if (Object.keys(tokenStore[userId]).length === 0) delete tokenStore[userId];
    saveToDisk();
    console.log(`[TokenStore] Removed ${provider} token for user ${userId}`);
  }
}

/**
 * Get auth status for all providers for a user.
 *
 * @param {string} userId
 * @returns {object} e.g. { google: { connected, email, last_used }, spotify: { ... } }
 */
function getAuthStatus(userId) {
  const providers = ['google', 'spotify'];
  const status = {};

  for (const provider of providers) {
    const data = getToken(userId, provider);
    if (data && data.access_token) {
      status[provider] = {
        connected:    isAuthenticated(userId, provider),
        email:        data.email || null,
        last_used:    data.last_used || null,
        connected_at: data.connected_at || null,
        scopes:       data.scopes || '',
      };
    } else {
      status[provider] = {
        connected:    false,
        email:        null,
        last_used:    null,
        connected_at: null,
        scopes:       '',
      };
    }
  }

  return status;
}

/**
 * Update the access token after a refresh.
 *
 * @param {string} userId
 * @param {string} provider
 * @param {string} newAccessToken
 * @param {number} expiresIn  – seconds
 */
function updateAccessToken(userId, provider, newAccessToken, expiresIn = 3600) {
  if (!tokenStore[userId]?.[provider]) return;
  tokenStore[userId][provider].access_token = newAccessToken;
  tokenStore[userId][provider].expiry_time  = Date.now() + expiresIn * 1000;
  tokenStore[userId][provider].last_used    = new Date().toISOString();
  saveToDisk();
}

module.exports = {
  saveToken,
  getToken,
  getAccessToken,
  isAuthenticated,
  touchLastUsed,
  removeToken,
  getAuthStatus,
  updateAccessToken,
};
