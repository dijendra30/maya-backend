require('dotenv').config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');

const audioRoute = require('./routes/audioRoute');
const chatRoute  = require('./routes/chatRoute');
const ttsRoute   = require('./routes/ttsRoute');
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
app.use(express.json({ limit: '12mb' })); // Phase 4: 12mb for base64 image uploads

app.use('/', chatRoute);
app.use('/', audioRoute);
app.use('/', ttsRoute);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Maya AI Router',
    phase: 4,
    tools: ['weather', 'air_quality', 'news', 'youtube', 'wikipedia'],
    tts: {
      provider: 'msedge-tts',
      voice: MAYA_VOICE,
      supportedVoices: SUPPORTED_VOICES,
      fileTtlSeconds: Math.round(MAX_AGE_MS / 1000),
      timeoutMs: TTS_TIMEOUT_MS,
    },
  });
});

app.get('/tts-test', async (req, res, next) => {
  try {
    res.json(await runSelfTest());
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(`[Maya] Unhandled error: ${err.stack || err.message}`);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Internal server error' });
});

cleanOldFiles().catch(error => console.warn(`[TTS] Startup cleanup failed: ${error.message}`));
setInterval(() => {
  cleanOldFiles().catch(error => console.warn(`[TTS] Scheduled cleanup failed: ${error.message}`));
}, CLEANUP_INTERVAL_MS).unref();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Maya AI Router Phase 4 running on http://0.0.0.0:${PORT}`);
  console.log(`Chat: POST /chat | Audio: GET /audio/:filename | Voice: ${MAYA_VOICE}`);
  console.log(`Tools: Weather, Air Quality, News, YouTube, Wikipedia (auto-routing)`);
});
