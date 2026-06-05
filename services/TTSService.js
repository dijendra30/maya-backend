/**
 * ╔══════════════════════════════════════════════════════════════════╗
 *  Maya TTS Service — Phase 2
 *  Microsoft Edge Neural TTS via msedge-tts npm package.
 *
 *  Voice:  en-US-AriaNeural (default) — override with TTS_VOICE env.
 *  Output: MP3 saved to temp/audio/, served at GET /audio/:filename.
 *  Cleanup: Files older than MAX_AGE_MS are auto-deleted on schedule.
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');

// ── Config ────────────────────────────────────────────────────────────────────

const TEMP_DIR   = path.join(__dirname, '../../temp/audio');
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — more than enough time to download

// Supported Maya voice options (configurable via .env)
const SUPPORTED_VOICES = [
  'en-US-AriaNeural',   // Female — warm, natural (DEFAULT)
  'en-US-JennyNeural',  // Female — friendly assistant
  'en-US-GuyNeural',    // Male   — confident
  'en-GB-BrianNeural',  // Male   — British accent
];

const MAYA_VOICE = SUPPORTED_VOICES.includes(process.env.TTS_VOICE)
  ? process.env.TTS_VOICE
  : 'en-US-AriaNeural';

// ── Directory Setup ───────────────────────────────────────────────────────────

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  console.log(`[TTS] Created temp directory: ${TEMP_DIR}`);
}

// ── Core: Text → MP3 ─────────────────────────────────────────────────────────

/**
 * Convert text to speech using Microsoft Edge Neural TTS.
 *
 * @param   {string} text  The text Maya should speak.
 * @returns {Promise<string>} The filename (not full path) of the generated MP3.
 * @throws  {Error}  If Edge TTS service is unreachable or text is empty.
 */
async function textToSpeech(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate TTS for empty text');
  }

  // Truncate very long responses to keep audio snappy (safety cap)
  const MAX_TTS_CHARS = 1500;
  const input = text.length > MAX_TTS_CHARS
    ? text.substring(0, MAX_TTS_CHARS) + '...'
    : text;

  const filename = `maya_${uuidv4()}.mp3`;
  const filePath = path.join(TEMP_DIR, filename);

  const startTime = Date.now();

  const tts = new MsEdgeTTS();
  await tts.setMetadata(MAYA_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  await tts.toFile(filePath, input);

  const elapsedMs = Date.now() - startTime;
  const sizeKB = Math.round(fs.statSync(filePath).size / 1024);

  console.log(`[TTS] ✓ Generated "${filename}" — ${sizeKB}KB in ${elapsedMs}ms (${MAYA_VOICE})`);

  return filename;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Delete audio files older than MAX_AGE_MS.
 * Called on a scheduled interval from index.js.
 */
function cleanOldFiles() {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now   = Date.now();
    let deleted = 0;

    for (const file of files) {
      if (!file.endsWith('.mp3')) continue;

      const filePath = path.join(TEMP_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch (e) {
        // File may have been deleted by another request — ignore
      }
    }

    if (deleted > 0) {
      console.log(`[TTS] 🧹 Cleaned ${deleted} old audio file(s)`);
    }
  } catch (err) {
    console.error('[TTS] Cleanup error:', err.message);
  }
}

/**
 * Delete a specific audio file immediately.
 * Not used in the main flow (cleanup handles it), but useful for manual purge.
 */
function deleteFile(filename) {
  try {
    const safe     = path.basename(filename); // strip any path traversal attempts
    const filePath = path.join(TEMP_DIR, safe);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[TTS] Deleted: ${safe}`);
    }
  } catch (err) {
    console.error('[TTS] deleteFile error:', err.message);
  }
}

/**
 * Check if an audio file exists.
 */
function fileExists(filename) {
  const safe = path.basename(filename);
  return fs.existsSync(path.join(TEMP_DIR, safe));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  textToSpeech,
  cleanOldFiles,
  deleteFile,
  fileExists,
  TEMP_DIR,
  MAYA_VOICE,
};
