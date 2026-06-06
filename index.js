require('dotenv').config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');

const audioRoute = require('./routes/audioRoute');
const chatRoute  = require('./routes/chatRoute');
const ttsRoute   = require('./routes/ttsRoute');
const authRoute  = require('./routes/authRoute');   // ← Phase 5: OAuth routes
const {
  MAYA_VOICE,
  MAX_AGE_MS,
  SUPPORTED_VOICES,
  TTS_TIMEOUT_MS,
  cleanOldFiles,
  runSelfTest,
} = require('./services/TTSService');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const CLEANUP_INTERVAL_MS = Number(process.env.TTS_CLEANUP_INTERVAL_MS || 5 * 60 * 1000);

app.set('trust proxy', true);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(express.json({ limit: '12mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', chatRoute);
app.use('/', audioRoute);
app.use('/', ttsRoute);
app.use('/', authRoute);   // GET /auth/google  /auth/status  etc.

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'Maya AI Router',
    phase:   5,
    tools: [
      'weather', 'air_quality', 'news', 'youtube', 'wikipedia',
      'calendar', 'tasks', 'gmail', 'drive',
      'location', 'music', 'vision',
    ],
    auth: {
      googleOAuth:  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      spotifyOAuth: !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
      endpoints: [
        'GET  /auth/google',
        'GET  /auth/google/callback',
        'GET  /auth/spotify',
        'GET  /auth/spotify/callback',
        'GET  /auth/status?userId=xxx',
        'POST /auth/logout',
        'GET  /auth/tools?userId=xxx',
      ],
    },
    tts: {
      provider:       'msedge-tts',
      voice:          MAYA_VOICE,
      supportedVoices: SUPPORTED_VOICES,
      fileTtlSeconds:  Math.round(MAX_AGE_MS / 1000),
      timeoutMs:       TTS_TIMEOUT_MS,
    },
  });
});

app.get('/tts-test', async (req, res, next) => {
  try { res.json(await runSelfTest()); }
  catch (error) { next(error); }
});

// ── 404 / Error ───────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(`[Maya] Unhandled error: ${err.stack || err.message}`);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Internal server error' });
});

// ── Startup ───────────────────────────────────────────────────────────────────
cleanOldFiles().catch(e => console.warn(`[TTS] Startup cleanup failed: ${e.message}`));
setInterval(() => {
  cleanOldFiles().catch(e => console.warn(`[TTS] Scheduled cleanup failed: ${e.message}`));
}, CLEANUP_INTERVAL_MS).unref();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Maya AI Router Phase 5 running on http://0.0.0.0:${PORT}`);
  console.log(`Chat: POST /chat | Audio: GET /audio/:filename | Voice: ${MAYA_VOICE}`);
  console.log(`OAuth: GET /auth/google | GET /auth/spotify | GET /auth/status`);
  console.log(`Tools: Weather, Air Quality, News, YouTube, Wikipedia, Calendar, Tasks, Gmail, Drive`);
});
