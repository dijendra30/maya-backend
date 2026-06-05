/**
 * ╔══════════════════════════════════════════════════════════════════╗
 *  Maya TTS Service — Phase 2.2  (Reliability fix)
 *
 *  ROOT CAUSE of audioUrl=null in previous version:
 *    <mstts:express-as style="chat"> was embedded INSIDE <prosody>
 *    in the msedge-tts template. Azure TTS rejects this nesting order
 *    (express-as must wrap prosody, not the other way around) and throws,
 *    which the chatController try-catch swallows → audioUrl stays null
 *    → Android falls back to system TTS → sounds robotic.
 *
 *  FIX:
 *    Pass clean plain text only — no custom SSML fragments.
 *    msedge-tts builds its own valid SSML template around the text.
 *    AriaNeural with clean input already sounds dramatically more
 *    natural than Android TTS or markdown-polluted text.
 *
 *  Text preprocessing is still applied — strips all markdown symbols
 *  that would be read literally ("asterisk asterisk bold asterisk…").
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');

// ── Config ────────────────────────────────────────────────────────────────────

const TEMP_DIR   = path.join(__dirname, '../../temp/audio');
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

const SUPPORTED_VOICES = [
  'en-US-AriaNeural',   // Female — warm, conversational (DEFAULT)
  'en-US-JennyNeural',  // Female — assistant style
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

// ── Text Preprocessor ─────────────────────────────────────────────────────────
//
// Strips all markdown and symbols that Edge TTS would read literally.
// This is the biggest single quality improvement — without it,
// "**Hello!**" is synthesised as "asterisk asterisk Hello asterisk asterisk".

function preprocessForTTS(raw) {
  let t = raw;

  // Code blocks  (``` ... ```)  → silent removal
  t = t.replace(/```[\w]*\n[\s\S]*?```/g, '');
  t = t.replace(/```[\s\S]*?```/g, '');

  // Inline code  (`word`)  → just the word
  t = t.replace(/`([^`\n]+)`/g, '$1');

  // Headings  (# ## ###)  → plain text
  t = t.replace(/^#{1,6}\s+/gm, '');

  // Bold  **text** or __text__
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  t = t.replace(/__([^_\n]+)__/g,     '$1');

  // Italic  *text* or _text_
  t = t.replace(/\*([^*\n]+)\*/g, '$1');
  t = t.replace(/_([^_\n]+)_/g,   '$1');

  // Strikethrough  ~~text~~
  t = t.replace(/~~([^~\n]+)~~/g, '$1');

  // Links  [label](url)  → label only
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Bare URLs  → "the link"
  t = t.replace(/https?:\/\/[^\s)>\]]+/g, 'the link');

  // Blockquotes  (> text)
  t = t.replace(/^>\s*/gm, '');

  // Horizontal rules  (--- or ***)
  t = t.replace(/^[-*_]{3,}\s*$/gm, '');

  // Bullet lists  (- item  *item  •item)
  t = t.replace(/^[\s]*[-*•]\s+/gm, '');

  // Numbered lists  (1. 2.)  → strip number, keep text
  t = t.replace(/^\s*\d+\.\s+/gm, '');

  // Tables  → remove pipes and dashes
  t = t.replace(/\|:?[-\s]+:?\|/g, '');
  t = t.replace(/\|/g, ' ');

  // Emoji (Unicode blocks)
  t = t.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
    ''
  );

  // Common symbol conversions
  t = t.replace(/ & /g,    ' and ');
  t = t.replace(/ \+ /g,   ' plus ');
  t = t.replace(/(\d)%/g,  '$1 percent');
  t = t.replace(/\$/g,     'dollars ');
  t = t.replace(/°C/g,     ' degrees Celsius');
  t = t.replace(/°F/g,     ' degrees Fahrenheit');
  t = t.replace(/°/g,      ' degrees');

  // Abbreviations → natural spoken form
  t = t.replace(/\be\.g\./gi,  'for example');
  t = t.replace(/\bi\.e\./gi,  'that is');
  t = t.replace(/\betc\./gi,   'and so on');
  t = t.replace(/\bvs\./gi,    'versus');
  t = t.replace(/\bDr\./g,     'Doctor');
  t = t.replace(/\bMr\./g,     'Mister');
  t = t.replace(/\bMrs\./g,    'Missus');

  // Normalise whitespace
  t = t.replace(/ {2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.trim();

  return t;
}

// ── Safe truncation at sentence boundary ─────────────────────────────────────

function truncateAtSentence(text, maxChars) {
  if (text.length <= maxChars) return text;
  const slice = text.substring(0, maxChars);
  const last  = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  );
  if (last > maxChars * 0.5) return slice.substring(0, last + 1).trim();
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.substring(0, lastSpace) : slice).trim() + '.';
}

// ── Core: Text → MP3 ─────────────────────────────────────────────────────────

/**
 * Convert AI response text to an MP3 file using Edge TTS neural voice.
 *
 * Pipeline: raw text → preprocessForTTS → plain text → msedge-tts → MP3
 * Retries once on transient failure (WebSocket drop, timeout, empty file).
 *
 * @param   {string} rawText  Raw AI response (may contain markdown).
 * @returns {Promise<string>} Filename of the generated MP3 in TEMP_DIR.
 * @throws  Re-throws after 2 failed attempts so chatController can log.
 */
async function textToSpeech(rawText) {
  if (!rawText || rawText.trim().length === 0) {
    throw new Error('Empty text');
  }

  // 1. Strip markdown / symbols
  const clean = preprocessForTTS(rawText);
  if (!clean) throw new Error('Text was empty after preprocessing');

  // 2. Truncate at sentence boundary (~1000 chars → ~30 s of speech)
  const input = truncateAtSentence(clean, 1000);
  console.log(`[TTS] Input (${input.length} chars): "${input.substring(0, 80)}${input.length > 80 ? '…' : ''}"`);

  // 3. Generate MP3 with retry — PLAIN TEXT, no custom SSML
  //    msedge-tts wraps this in its own valid SSML template internally.
  const filename  = `maya_${uuidv4()}.mp3`;
  const filePath  = path.join(TEMP_DIR, filename);
  const startTime = Date.now();

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(MAYA_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      await tts.toFile(filePath, input);

      // Verify file was actually written and has content
      if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        throw new Error('TTS generated an empty or missing file');
      }

      const elapsedMs = Date.now() - startTime;
      const sizeKB    = Math.round(fs.statSync(filePath).size / 1024);
      if (attempt > 1) console.log(`[TTS] ✓ Recovered on attempt ${attempt}`);
      console.log(`[TTS] ✓ ${filename} — ${sizeKB}KB in ${elapsedMs}ms (${MAYA_VOICE})`);
      return filename;

    } catch (err) {
      lastError = err;
      console.warn(`[TTS] ✗ Attempt ${attempt}/2 failed: ${err.message}`);
      // Clean up any partial file before retrying
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      if (attempt < 2) await new Promise(r => setTimeout(r, 600)); // brief pause
    }
  }

  throw new Error(`TTS failed after 2 attempts: ${lastError?.message}`);
}

// ── Quick smoke-test (used by GET /tts-test) ──────────────────────────────────

/**
 * Run a short test synthesis to verify Edge TTS is reachable.
 * Returns { ok: true, ms, sizeKB } or throws with a descriptive message.
 */
async function runSelfTest() {
  const TEST_TEXT = 'Maya voice test. Edge TTS is working correctly.';
  const filename  = `test_${uuidv4()}.mp3`;
  const filePath  = path.join(TEMP_DIR, filename);
  const t0        = Date.now();

  const tts = new MsEdgeTTS();
  await tts.setMetadata(MAYA_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  await tts.toFile(filePath, TEST_TEXT);

  const ms     = Date.now() - t0;
  const sizeKB = Math.round(fs.statSync(filePath).size / 1024);

  // Clean up test file immediately
  try { fs.unlinkSync(filePath); } catch (_) {}

  return { ok: true, ms, sizeKB, voice: MAYA_VOICE };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanOldFiles() {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now   = Date.now();
    let deleted = 0;
    for (const file of files) {
      // Only delete maya-generated files — never touch anything else in the dir
      if (!file.startsWith('maya_') || !file.endsWith('.mp3')) continue;
      try {
        const fp = path.join(TEMP_DIR, file);
        if (now - fs.statSync(fp).mtimeMs > MAX_AGE_MS) { fs.unlinkSync(fp); deleted++; }
      } catch (_) {}
    }
    if (deleted > 0) console.log(`[TTS] 🧹 Cleaned ${deleted} old file(s)`);
  } catch (err) {
    console.error('[TTS] Cleanup error:', err.message);
  }
}

function deleteFile(filename) {
  try {
    const fp = path.join(TEMP_DIR, path.basename(filename));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (_) {}
}

function fileExists(filename) {
  return fs.existsSync(path.join(TEMP_DIR, path.basename(filename)));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  textToSpeech,
  runSelfTest,
  cleanOldFiles,
  deleteFile,
  fileExists,
  preprocessForTTS,
  TEMP_DIR,
  MAYA_VOICE,
};
