/**
 * ╔══════════════════════════════════════════════════════════════════╗
 *  Maya Audio Route — Phase 2
 *  Serves generated MP3 files to the Android app.
 *
 *  GET /audio/:filename
 *    → Streams the MP3 with correct headers.
 *    → 400 if filename is invalid / suspicious.
 *    → 404 if file doesn't exist (already cleaned up).
 *    → Supports Range requests (Android MediaPlayer needs this).
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { TEMP_DIR, fileExists } = require('../services/TTSService');

/**
 * GET /audio/:filename
 *
 * Streams a Maya-generated MP3 to the Android client.
 * Supports HTTP Range requests so Android MediaPlayer / ExoPlayer
 * can seek or resume partial downloads.
 */
router.get('/audio/:filename', (req, res) => {
  const { filename } = req.params;

  // ── Security: reject any path-traversal or non-MP3 attempts ────────────────
  const safe = path.basename(filename); // strips leading ../ or ./
  if (
    safe !== filename ||           // original had path separators
    !safe.startsWith('maya_') ||   // must be a Maya-generated file
    !safe.endsWith('.mp3') ||      // must be MP3
    safe.includes('..')            // double-check traversal
  ) {
    return res.status(400).json({ error: 'Invalid audio filename' });
  }

  const filePath = path.join(TEMP_DIR, safe);

  if (!fs.existsSync(filePath)) {
    console.warn(`[Audio] 404 — file not found: ${safe}`);
    return res.status(404).json({ error: 'Audio file not found or already expired' });
  }

  const stat     = fs.statSync(filePath);
  const fileSize = stat.size;
  const rangeHeader = req.headers['range'];

  // ── Range request (Android ExoPlayer / MediaPlayer seeks) ──────────────────
  if (rangeHeader) {
    const parts  = rangeHeader.replace(/bytes=/, '').split('-');
    const start  = parseInt(parts[0], 10);
    const end    = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunkSize,
      'Content-Type':   'audio/mpeg',
      'Cache-Control':  'no-cache',
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  // ── Full file (first request from Android) ──────────────────────────────────
  res.writeHead(200, {
    'Content-Type':   'audio/mpeg',
    'Content-Length': fileSize,
    'Accept-Ranges':  'bytes',
    'Cache-Control':  'no-cache',
  });

  const stream = fs.createReadStream(filePath);

  stream.on('error', (err) => {
    console.error(`[Audio] Stream error for ${safe}:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream audio file' });
    }
  });

  stream.pipe(res);

  console.log(`[Audio] ▶ Streaming ${safe} (${Math.round(fileSize / 1024)}KB) to ${req.ip}`);
});

module.exports = router;
