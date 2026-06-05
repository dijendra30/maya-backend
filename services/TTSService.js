const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pipeline } = require('stream/promises');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const TEMP_DIR = path.resolve(process.env.TTS_TEMP_DIR || path.join(process.cwd(), 'temp', 'audio'));
const MAX_AGE_MS = Number(process.env.TTS_FILE_TTL_MS || 10 * 60 * 1000);
const TTS_TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS || 12_000);
const TTS_MAX_CHARS = Number(process.env.TTS_MAX_CHARS || 1000);

const SUPPORTED_VOICES = [
  'en-US-AriaNeural',
  'en-US-JennyNeural',
  'en-US-GuyNeural',
  'en-GB-BrianNeural',
];

const DEFAULT_VOICE = 'en-US-AriaNeural';
const MAYA_VOICE = SUPPORTED_VOICES.includes(process.env.TTS_VOICE)
  ? process.env.TTS_VOICE
  : DEFAULT_VOICE;

fs.mkdirSync(TEMP_DIR, { recursive: true });

function preprocessForTTS(rawText) {
  if (typeof rawText !== 'string') return '';

  let text = rawText;

  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`([^`\n]+)`/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  text = text.replace(/__([^_\n]+)__/g, '$1');
  text = text.replace(/\*([^*\n]+)\*/g, '$1');
  text = text.replace(/_([^_\n]+)_/g, '$1');
  text = text.replace(/~~([^~\n]+)~~/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/https?:\/\/[^\s)>\]]+/g, 'the link');
  text = text.replace(/^>\s*/gm, '');
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');
  text = text.replace(/^\s*[-*]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/\|:?[-\s]+:?\|/g, '');
  text = text.replace(/\|/g, ' ');
  text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
  text = text.replace(/ & /g, ' and ');
  text = text.replace(/ \+ /g, ' plus ');
  text = text.replace(/(\d)%/g, '$1 percent');
  text = text.replace(/\$/g, 'dollars ');
  text = text.replace(/\bUSD\b/g, 'U.S. dollars');
  text = text.replace(/\be\.g\./gi, 'for example');
  text = text.replace(/\bi\.e\./gi, 'that is');
  text = text.replace(/\betc\./gi, 'and so on');
  text = text.replace(/\bvs\./gi, 'versus');
  text = text.replace(/\bDr\./g, 'Doctor');
  text = text.replace(/\bMr\./g, 'Mister');
  text = text.replace(/\bMrs\./g, 'Missus');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function truncateAtSentence(text, maxChars = TTS_MAX_CHARS) {
  if (text.length <= maxChars) return text;

  const slice = text.slice(0, maxChars);
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  );

  if (sentenceEnd > maxChars * 0.5) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }

  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim()}.`;
}

function escapeSsmlText(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function createAudioFilename() {
  return `maya_${Date.now()}_${crypto.randomUUID()}.mp3`;
}

function isGeneratedAudioFilename(filename) {
  return /^maya_\d{13}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.mp3$/i
    .test(filename);
}

function getAudioFilePath(filename) {
  if (!isGeneratedAudioFilename(filename)) {
    throw new Error('Invalid audio filename');
  }

  const resolved = path.resolve(TEMP_DIR, filename);
  if (!resolved.startsWith(`${TEMP_DIR}${path.sep}`)) {
    throw new Error('Invalid audio path');
  }

  return resolved;
}

function ttsOptions() {
  return {
    rate: process.env.TTS_RATE || '+0%',
    pitch: process.env.TTS_PITCH || '+0Hz',
    volume: process.env.TTS_VOLUME || '+0%',
  };
}

async function synthesizeToFile(input, tmpPath, voice) {
  const tts = new MsEdgeTTS();

  try {
    await withTimeout(
      tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
        sentenceBoundaryEnabled: false,
        wordBoundaryEnabled: false,
      }),
      TTS_TIMEOUT_MS,
      'Edge TTS metadata',
    );

    const { audioStream } = tts.toStream(input, ttsOptions());
    await withTimeout(
      pipeline(audioStream, fs.createWriteStream(tmpPath, { flags: 'wx' })),
      TTS_TIMEOUT_MS,
      'Edge TTS audio stream',
    );
  } finally {
    tts.close();
  }
}

async function textToSpeech(rawText, options = {}) {
  const clean = preprocessForTTS(rawText);
  if (!clean) {
    throw new Error('Text was empty after TTS preprocessing');
  }

  const voice = SUPPORTED_VOICES.includes(options.voice) ? options.voice : MAYA_VOICE;
  const input = escapeSsmlText(truncateAtSentence(clean));
  const filename = createAudioFilename();
  const finalPath = getAudioFilePath(filename);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  const startedAt = Date.now();

  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await synthesizeToFile(input, tmpPath, voice);
      const stat = await fsp.stat(tmpPath);
      if (stat.size === 0) {
        throw new Error('Edge TTS returned an empty audio file');
      }

      await fsp.rename(tmpPath, finalPath);

      const durationMs = Date.now() - startedAt;
      console.log(`[TTS] Generated ${filename} (${Math.round(stat.size / 1024)}KB) in ${durationMs}ms using ${voice}`);

      return {
        filename,
        filePath: finalPath,
        sizeBytes: stat.size,
        durationMs,
        voice,
      };
    } catch (error) {
      lastError = error;
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
      await fsp.rm(finalPath, { force: true }).catch(() => {});

      console.warn(`[TTS] Attempt ${attempt}/2 failed: ${error.message}`);
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }
  }

  throw new Error(`Edge TTS failed after 2 attempts: ${lastError?.message || 'unknown error'}`);
}

async function runSelfTest() {
  const result = await textToSpeech('Maya voice test. Edge TTS is working correctly.');
  await deleteFile(result.filename);

  return {
    ok: true,
    ms: result.durationMs,
    sizeKB: Math.round(result.sizeBytes / 1024),
    voice: result.voice,
  };
}

async function cleanOldFiles() {
  await fsp.mkdir(TEMP_DIR, { recursive: true });

  const now = Date.now();
  const entries = await fsp.readdir(TEMP_DIR, { withFileTypes: true });
  let deleted = 0;

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !isGeneratedAudioFilename(entry.name)) return;

    const filePath = path.join(TEMP_DIR, entry.name);

    try {
      const stat = await fsp.stat(filePath);
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        await fsp.rm(filePath, { force: true });
        deleted += 1;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`[TTS] Cleanup skipped ${entry.name}: ${error.message}`);
      }
    }
  }));

  if (deleted > 0) {
    console.log(`[TTS] Cleaned ${deleted} expired audio file(s)`);
  }

  return deleted;
}

async function deleteFile(filename) {
  if (!isGeneratedAudioFilename(filename)) return false;

  await fsp.rm(getAudioFilePath(filename), { force: true });
  return true;
}

async function fileExists(filename) {
  try {
    await fsp.access(getAudioFilePath(filename), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_VOICE,
  MAYA_VOICE,
  SUPPORTED_VOICES,
  TEMP_DIR,
  MAX_AGE_MS,
  TTS_TIMEOUT_MS,
  cleanOldFiles,
  deleteFile,
  fileExists,
  getAudioFilePath,
  isGeneratedAudioFilename,
  preprocessForTTS,
  runSelfTest,
  textToSpeech,
};
