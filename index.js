require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');

const chatRoute  = require('./routes/chatRoute');
const audioRoute = require('./routes/audioRoute');
const { cleanOldFiles, MAYA_VOICE } = require('./services/TTSService');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors());
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/', chatRoute);   // POST /chat
app.use('/', audioRoute);  // GET  /audio/:filename

// ── Health Check ──────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status:   'ok',
    service:  'Maya AI Router',
    phase:    2,
    ttsVoice: MAYA_VOICE,
  });
});

// ── Error Handler ─────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[Maya] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

// ── Audio Cleanup Schedule ────────────────────────────────────────────────────
// Delete temp MP3 files older than 10 minutes — runs every 5 minutes.

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(cleanOldFiles, CLEANUP_INTERVAL_MS);

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
  🔵  Maya AI Router  —  Phase 2
╚══════════════════════════════════════════════════════╝
  Health : http://localhost:${PORT}/health
  Chat   : POST http://localhost:${PORT}/chat
  Audio  : GET  http://localhost:${PORT}/audio/:filename
  Voice  : ${MAYA_VOICE}
  Cleanup: every ${CLEANUP_INTERVAL_MS / 60000} min
`);
});
