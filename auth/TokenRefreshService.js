/**
 * Maya AI — OAuth Token Refresh Service
 *
 * Handles automatic token refresh for Google and Spotify.
 * Called before any tool execution when token is near expiry.
 */

const axios      = require('axios');
const TokenStore = require('./TokenStore');

const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Refresh if token expires within 5 minutes
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Refresh Google access token using stored refresh_token.
 *
 * @param {string} userId
 * @returns {string|null} new access token or null on failure
 */
async function refreshGoogleToken(userId) {
  const tokenData = TokenStore.getToken(userId, 'google');
  if (!tokenData?.refresh_token) {
    console.warn(`[TokenRefresh] No Google refresh_token for user ${userId}`);
    return null;
  }

  try {
    const params = new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokenData.refresh_token,
      grant_type:    'refresh_token',
    });

    const { data } = await axios.post(GOOGLE_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });

    TokenStore.updateAccessToken(userId, 'google', data.access_token, data.expires_in || 3600);
    console.log(`[TokenRefresh] Google token refreshed for user ${userId}`);
    return data.access_token;

  } catch (err) {
    console.error(`[TokenRefresh] Google refresh failed for ${userId}: ${err.response?.data?.error || err.message}`);
    return null;
  }
}

/**
 * Refresh Spotify access token using stored refresh_token.
 *
 * @param {string} userId
 * @returns {string|null} new access token or null on failure
 */
async function refreshSpotifyToken(userId) {
  const tokenData = TokenStore.getToken(userId, 'spotify');
  if (!tokenData?.refresh_token) {
    console.warn(`[TokenRefresh] No Spotify refresh_token for user ${userId}`);
    return null;
  }

  try {
    const credentials = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64');

    const params = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: tokenData.refresh_token,
    });

    const { data } = await axios.post(SPOTIFY_TOKEN_URL, params.toString(), {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    });

    TokenStore.updateAccessToken(userId, 'spotify', data.access_token, data.expires_in || 3600);
    // Spotify may return a new refresh_token
    if (data.refresh_token) {
      const existing = TokenStore.getToken(userId, 'spotify');
      TokenStore.saveToken(userId, 'spotify', {
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_in:    data.expires_in || 3600,
        email:         existing?.email,
      });
    }

    console.log(`[TokenRefresh] Spotify token refreshed for user ${userId}`);
    return data.access_token;

  } catch (err) {
    console.error(`[TokenRefresh] Spotify refresh failed for ${userId}: ${err.message}`);
    return null;
  }
}

/**
 * Get a valid access token for a provider, auto-refreshing if needed.
 *
 * @param {string} userId
 * @param {string} provider – 'google' | 'spotify'
 * @returns {string|null}
 */
async function getValidToken(userId, provider) {
  const tokenData = TokenStore.getToken(userId, provider);
  if (!tokenData?.access_token) return null;

  const needsRefresh = Date.now() > (tokenData.expiry_time - REFRESH_THRESHOLD_MS);

  if (!needsRefresh) {
    TokenStore.touchLastUsed(userId, provider);
    return tokenData.access_token;
  }

  console.log(`[TokenRefresh] Token near expiry, refreshing ${provider} for ${userId}…`);

  if (provider === 'google')  return refreshGoogleToken(userId);
  if (provider === 'spotify') return refreshSpotifyToken(userId);
  return null;
}

module.exports = { refreshGoogleToken, refreshSpotifyToken, getValidToken };
