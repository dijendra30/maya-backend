/**
 * Maya AI — OAuth Routes
 *
 * GET  /auth/google              → redirect to Google OAuth consent screen
 * GET  /auth/google/callback     → handle Google OAuth callback
 * GET  /auth/spotify             → redirect to Spotify OAuth consent screen
 * GET  /auth/spotify/callback    → handle Spotify OAuth callback
 * GET  /auth/status              → get connection status for all providers
 * POST /auth/logout              → disconnect a provider
 * GET  /auth/tools               → get full tool registry with auth status
 *
 * userId: sent as query param (?userId=xxx) or in body.
 * For production replace with proper session/JWT.
 */

const express      = require('express');
const axios        = require('axios');
const router       = express.Router();
const TokenStore   = require('../auth/TokenStore');
const ToolRegistry = require('../auth/ToolRegistry');

const GOOGLE_AUTH_URL   = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const SPOTIFY_AUTH_URL  = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

function getRedirectBase(req) {
  return process.env.SERVER_URL || `${req.protocol}://${req.get('host')}`;
}

// ── POST /auth/google/verify ──────────────────────────────────────────────────
// Receives an ID token from Android, verifies it with Google, and stores
// the user session in TokenStore so /auth/status returns connected=true.
// Uses a 24-hour expiry (Android ID tokens are refreshed on app restart via
// silent sign-in, which calls verifyGoogleWithBackend again).

router.post('/auth/google/verify', async (req, res) => {
  const { idToken, accessToken, userId } = req.body || {};

  if (!idToken || typeof idToken !== 'string') {
    return res.status(400).json({ success: false, message: 'idToken is required' });
  }

  const resolvedUserId = (typeof userId === 'string' && userId.trim()) ? userId.trim() : 'default';

  try {
    // Verify the ID token via Google's public tokeninfo endpoint
    const { data: tokenInfo } = await axios.get(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { timeout: 10000 }
    );

    const { email, sub, aud, exp } = tokenInfo;

    if (!email) {
      return res.status(401).json({ success: false, message: 'Token contains no email' });
    }

    // Verify token has not expired
    if (exp && Date.now() / 1000 > Number(exp)) {
      return res.status(401).json({ success: false, message: 'ID token has expired' });
    }

    // Verify audience matches our Web Client ID
    const expectedAud = process.env.GOOGLE_CLIENT_ID;
    if (!expectedAud) {
      console.error('[Auth/Verify] GOOGLE_CLIENT_ID not set in .env — cannot validate token audience. Set GOOGLE_CLIENT_ID to your Web OAuth Client ID.');
      return res.status(500).json({ success: false, message: 'Server misconfiguration: GOOGLE_CLIENT_ID not set' });
    }
    if (aud !== expectedAud) {
      console.error(`[Auth/Verify] aud mismatch: token=${aud} env=${expectedAud}`);
      console.error('[Auth/Verify] Fix: GOOGLE_CLIENT_ID in .env must match strings.xml google_web_client_id in the Android app');
      return res.status(401).json({ success: false, message: 'Token audience mismatch — check GOOGLE_CLIENT_ID in .env' });
    }

    // Store in TokenStore with 24-hour expiry.
    // Android silent sign-in re-verifies on each app start, keeping session alive.
    // The access token from the Android client is stored for Google API calls.
    TokenStore.saveToken(resolvedUserId, 'google', {
      access_token:  accessToken || idToken,
      refresh_token: null,
      expires_in:    86400,   // 24 hours — refreshed each app start via silent sign-in
      email,
      sub,
    });

    console.log(`[Auth/Verify] Google verified for user ${resolvedUserId} (${email})`);
    return res.json({ success: true, email, message: 'Google account connected' });

  } catch (err) {
    const detail = err.response?.data?.error_description || err.response?.data?.error || err.message;
    console.error('[Auth/Verify] Google ID token verification failed:', detail);
    return res.status(401).json({ success: false, message: `Verification failed: ${detail}` });
  }
});

// ── GET /auth/google ──────────────────────────────────────────────────────────

router.get('/auth/google', (req, res) => {
  const userId  = req.query.userId || 'default';
  const baseUrl = getRedirectBase(req);

  const scopes = [
    'email',
    'profile',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/tasks',
  ].join(' ');

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${baseUrl}/auth/google/callback`,
    response_type: 'code',
    scope:         scopes,
    access_type:   'offline',
    prompt:        'consent',
    state:         userId,
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

// ── GET /auth/google/callback ─────────────────────────────────────────────────

router.get('/auth/google/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  const baseUrl = getRedirectBase(req);

  if (error || !code) {
    console.error('[OAuth] Google callback error:', error);
    return res.redirect(`${process.env.APP_DEEP_LINK || '/auth/result'}?status=error&provider=google&reason=${error || 'no_code'}`);
  }

  try {
    const params = new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  `${baseUrl}/auth/google/callback`,
      grant_type:    'authorization_code',
    });

    const { data } = await axios.post(GOOGLE_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });

    // Get user email
    let email = null;
    try {
      const userInfo = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      email = userInfo.data.email;
    } catch (_) {}

    TokenStore.saveToken(userId || 'default', 'google', {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_in:    data.expires_in,
      scope:         data.scope,
      email,
    });

    console.log(`[OAuth] Google connected for user ${userId} (${email})`);

    // Deep-link back to Android app or show success page
    const deepLink = process.env.APP_DEEP_LINK;
    if (deepLink) {
      return res.redirect(`${deepLink}?status=success&provider=google&email=${encodeURIComponent(email || '')}`);
    }
    return res.send(successPage('Google', email));

  } catch (err) {
    console.error('[OAuth] Google token exchange failed:', err.response?.data || err.message);
    return res.status(500).send(errorPage('Google', err.message));
  }
});

// ── GET /auth/spotify ─────────────────────────────────────────────────────────

router.get('/auth/spotify', (req, res) => {
  const userId  = req.query.userId || 'default';
  const baseUrl = getRedirectBase(req);

  const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'streaming',
  ].join(' ');

  const params = new URLSearchParams({
    client_id:     process.env.SPOTIFY_CLIENT_ID,
    redirect_uri:  `${baseUrl}/auth/spotify/callback`,
    response_type: 'code',
    scope:         scopes,
    state:         userId,
  });

  res.redirect(`${SPOTIFY_AUTH_URL}?${params.toString()}`);
});

// ── GET /auth/spotify/callback ────────────────────────────────────────────────

router.get('/auth/spotify/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  const baseUrl = getRedirectBase(req);

  if (error || !code) {
    return res.redirect(`${process.env.APP_DEEP_LINK || '/auth/result'}?status=error&provider=spotify&reason=${error || 'no_code'}`);
  }

  try {
    const credentials = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64');

    const params = new URLSearchParams({
      code,
      redirect_uri: `${baseUrl}/auth/spotify/callback`,
      grant_type:   'authorization_code',
    });

    const { data } = await axios.post(SPOTIFY_TOKEN_URL, params.toString(), {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    });

    // Get Spotify user info
    let email = null;
    try {
      const userInfo = await axios.get('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      email = userInfo.data.email;
    } catch (_) {}

    TokenStore.saveToken(userId || 'default', 'spotify', {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_in:    data.expires_in,
      scope:         data.scope,
      email,
    });

    console.log(`[OAuth] Spotify connected for user ${userId} (${email})`);

    const deepLink = process.env.APP_DEEP_LINK;
    if (deepLink) {
      return res.redirect(`${deepLink}?status=success&provider=spotify&email=${encodeURIComponent(email || '')}`);
    }
    return res.send(successPage('Spotify', email));

  } catch (err) {
    console.error('[OAuth] Spotify token exchange failed:', err.message);
    return res.status(500).send(errorPage('Spotify', err.message));
  }
});

// ── GET /auth/status ──────────────────────────────────────────────────────────

router.get('/auth/status', (req, res) => {
  const userId = req.query.userId || 'default';
  const authStatus = TokenStore.getAuthStatus(userId);
  const tools = ToolRegistry.getAllTools();

  // Build enriched tool status
  const toolStatus = tools.map(tool => ({
    id:           tool.id,
    label:        tool.label,
    icon:         tool.icon,
    installed:    tool.installed,
    requiresAuth: tool.requiresAuth,
    authProvider: tool.authProvider,
    authenticated: !tool.requiresAuth || (
      authStatus[tool.authProvider]?.connected === true
    ),
    description:  tool.description,
  }));

  res.json({
    userId,
    providers: authStatus,
    tools:     toolStatus,
    summary: {
      google_connected:  authStatus.google?.connected  || false,
      spotify_connected: authStatus.spotify?.connected || false,
      total_tools:       tools.length,
      auth_ready_tools:  toolStatus.filter(t => t.authenticated).length,
      locked_tools:      toolStatus.filter(t => !t.authenticated).length,
    },
  });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────

router.post('/auth/logout', (req, res) => {
  const userId   = req.body?.userId || req.query.userId || 'default';
  const provider = req.body?.provider || req.query.provider;

  if (!provider || !['google', 'spotify'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be "google" or "spotify"' });
  }

  TokenStore.removeToken(userId, provider);
  res.json({ success: true, message: `${provider} disconnected for user ${userId}` });
});

// ── GET /auth/tools ───────────────────────────────────────────────────────────

router.get('/auth/tools', (req, res) => {
  const userId     = req.query.userId || 'default';
  const authStatus = TokenStore.getAuthStatus(userId);
  const tools      = ToolRegistry.getAllTools();

  const grouped = {
    available:     [],
    requiresGoogle:  [],
    requiresSpotify: [],
    authenticated:   [],
  };

  for (const tool of tools) {
    if (!tool.requiresAuth) {
      grouped.available.push({ ...tool, authenticated: true });
    } else if (tool.authProvider === 'google') {
      const isAuth = authStatus.google?.connected === true;
      grouped.requiresGoogle.push({ ...tool, authenticated: isAuth });
      if (isAuth) grouped.authenticated.push({ ...tool, authenticated: true });
    } else if (tool.authProvider === 'spotify') {
      const isAuth = authStatus.spotify?.connected === true;
      grouped.requiresSpotify.push({ ...tool, authenticated: isAuth });
      if (isAuth) grouped.authenticated.push({ ...tool, authenticated: true });
    }
  }

  res.json({ userId, grouped, providers: authStatus });
});

// ── HTML helper pages ─────────────────────────────────────────────────────────

function successPage(provider, email) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Maya — Connected</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f1117;color:#fff;margin:0}
.card{text-align:center;padding:40px;background:#1a1d2e;border-radius:16px;border:1px solid #2d3748}
h1{color:#48bb78;font-size:2rem;margin-bottom:8px}p{color:#a0aec0;margin:4px 0}
.close{margin-top:24px;background:#2d3748;color:#e2e8f0;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:1rem}</style>
</head><body><div class="card">
<h1>✅ Connected!</h1>
<p><strong>${provider}</strong> account linked to Maya.</p>
${email ? `<p style="color:#63b3ed">${email}</p>` : ''}
<p style="margin-top:16px;font-size:0.9rem;color:#718096">You can close this tab and return to Maya.</p>
<button class="close" onclick="window.close()">Close Tab</button>
</div></body></html>`;
}

function errorPage(provider, message) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Maya — Error</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f1117;color:#fff;margin:0}
.card{text-align:center;padding:40px;background:#1a1d2e;border-radius:16px;border:1px solid #742a2a}
h1{color:#fc8181;font-size:2rem}p{color:#a0aec0}</style>
</head><body><div class="card">
<h1>❌ Connection Failed</h1>
<p>${provider} authentication failed.</p>
<p style="font-size:0.8rem;margin-top:8px;color:#718096">${message}</p>
</div></body></html>`;
}

module.exports = router;
