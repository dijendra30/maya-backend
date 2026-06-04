require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');

const chatRoute = require('./routes/chatRoute');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(helmet());   // security headers
app.use(cors());     // allow Android app to reach the server
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/', chatRoute);

// Health check — useful to verify the server is reachable from the device
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Maya AI Router' });
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[Maya] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔵 Maya AI Router running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Chat:   POST http://localhost:${PORT}/chat\n`);
});
