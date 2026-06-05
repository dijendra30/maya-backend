/**
 * ╔══════════════════════════════════════════════════════════════════╗
 *  Maya TTS Service — Phase 2.1  (Natural Voice Upgrade)
 *
 *  Two root causes of "robotic" voice fixed here:
 *
 *  1. TEXT PREPROCESSING
 *     AI responses contain markdown (**bold**, *italic*, # headers,
 *     - bullets, `code`, URLs, emojis…).  Without cleaning, Edge TTS
 *     reads them literally:
 *       "asterisk asterisk hello asterisk asterisk hashtag tip"
 *     preprocessForTTS() strips all of this before synthesis.
 *
 *  2. SSML CONVERSATIONAL STYLE
 *     AriaNeural's default style is formal/newscast.
 *     <mstts:express-as style="chat"> switches it to relaxed,
 *     natural, human-like delivery — the single biggest improvement.
 *     Sentence-boundary <break> tags add natural pacing.
 *
 *  Result: clean text + chat style = sounds like a real person.
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');

// ── Config ────────────────────────────────────────────────────────────────────

const TEMP_DIR   = path.join(__dirname, '../../temp/audio');
const MAX_AGE_MS = 10 * 60 * 1000;

// Voices — configurable via TTS_VOICE env
// Styles per voice (Edge TTS SSML express-as):
//   AriaNeural  → chat | customerservice | narration-professional | cheerful | empathetic
//   JennyNeural → assistant | chat | customerservice
//   GuyNeural   → newscast | conversational
//   BrianNeural → (British, uses default style)
const SUPPORTED_VOICES = [
  'en-US-AriaNeural',
  'en-US-JennyNeural',
  'en-US-GuyNeural',
  'en-GB-BrianNeural',
];

const MAYA_VOICE = SUPPORTED_VOICES.includes(process.env.TTS_VOICE)
  ? process.env.TTS_VOICE
  : 'en-US-AriaNeural';

// SSML speaking style — override via TTS_STYLE env
// 'chat' = most natural, relaxed, conversational delivery
const MAYA_STYLE = process.env.TTS_STYLE || 'chat';

// ── Directory Setup ───────────────────────────────────────────────────────────

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  console.log(`[TTS] Created temp directory: ${TEMP_DIR}`);
}

// ── Text Preprocessor ─────────────────────────────────────────────────────────
//
// Strips everything that makes TTS sound robotic when read literally.
// Run BEFORE sending text to Edge TTS — this is the #1 quality lever.

/**
 * Clean AI response text for natural TTS delivery.
 * Removes all markdown formatting, symbols, and structures that
 * Edge TTS would read literally and sound unnatural.
 *
 * @param   {string} raw  Raw AI response text (may contain markdown).
 * @returns {string}      Clean plain text suitable for speech synthesis.
 */
function preprocessForTTS(raw) {
  let text = raw;

  // ── 1. Code blocks (```...```) → brief placeholder ──────────────────────
  // Multi-line code blocks are useless spoken aloud
  text = text.replace(/```[\w]*\n[\s\S]*?```/g, 'code example');
  text = text.replace(/```[\s\S]*?```/g,        'code example');

  // ── 2. Inline code (`code`) → unwrap, keep the word ──────────────────────
  text = text.replace(/`([^`\n]+)`/g, '$1');

  // ── 3. Markdown headings (# ## ### etc.) → just the heading text ─────────
  text = text.replace(/^#{1,6}\s+/gm, '');

  // ── 4. Bold (**text** and __text__) → plain text ─────────────────────────
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  text = text.replace(/__([^_\n]+)__/g,     '$1');

  // ── 5. Italic (*text* and _text_) → plain text ───────────────────────────
  // Must run after bold so **text** is already handled
  text = text.replace(/\*([^*\n]+)\*/g, '$1');
  text = text.replace(/_([^_\n]+)_/g,   '$1');

  // ── 6. Strikethrough (~~text~~) → plain text ─────────────────────────────
  text = text.replace(/~~([^~\n]+)~~/g, '$1');

  // ── 7. Markdown links [label](url) → just the label ──────────────────────
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // ── 8. Bare URLs → "the link" ─────────────────────────────────────────────
  text = text.replace(/https?:\/\/[^\s)>\]]+/g, 'the link');

  // ── 9. Blockquotes (> text) → plain text ─────────────────────────────────
  text = text.replace(/^>\s*/gm, '');

  // ── 10. Horizontal rules (--- or *** or ___) → pause (period) ────────────
  text = text.replace(/^[-*_]{3,}\s*$/gm, '.');

  // ── 11. Bullet lists (- item, * item, • item) → natural sentence ─────────
  // Add comma + space so items are read as a list, not run together
  text = text.replace(/^[\s]*[-*•]\s+/gm, '');

  // ── 12. Numbered lists (1. 2. 3.) → keep text, strip the number+dot ──────
  text = text.replace(/^\s*\d+\.\s+/gm, '');

  // ── 13. Markdown tables → remove pipe/dash structure ─────────────────────
  text = text.replace(/\|:?[-]+:?\|/g, ''); // separator rows
  text = text.replace(/\|/g, ' ');           // cell dividers

  // ── 14. Emoji (Unicode range) → remove silently ──────────────────────────
  // Edge TTS either reads emoji names or skips them — both sound weird
  text = text.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
    ''
  );

  // ── 15. Common symbol conversions ────────────────────────────────────────
  text = text.replace(/&amp;/g,  'and');
  text = text.replace(/&lt;/g,   'less than');
  text = text.replace(/&gt;/g,   'greater than');
  text = text.replace(/ & /g,    ' and ');
  text = text.replace(/ \+ /g,   ' plus ');
  text = text.replace(/ = /g,    ' equals ');
  text = text.replace(/(\d)%/g,  '$1 percent');
  text = text.replace(/\$/g,     'dollars ');
  text = text.replace(/€/g,      'euros ');
  text = text.replace(/£/g,      'pounds ');
  text = text.replace(/°C/g,     ' degrees Celsius');
  text = text.replace(/°F/g,     ' degrees Fahrenheit');
  text = text.replace(/°/g,      ' degrees');

  // ── 16. Abbreviation naturalisation ──────────────────────────────────────
  text = text.replace(/\be\.g\./gi,  'for example');
  text = text.replace(/\bi\.e\./gi,  'that is');
  text = text.replace(/\betc\./gi,   'and so on');
  text = text.replace(/\bvs\./gi,    'versus');
  text = text.replace(/\bDr\./g,     'Doctor');
  text = text.replace(/\bMr\./g,     'Mister');
  text = text.replace(/\bMrs\./g,    'Missus');

  // ── 17. Normalise whitespace ──────────────────────────────────────────────
  // Collapse multiple spaces
  text = text.replace(/ {2,}/g, ' ');

  // Collapse 3+ newlines to 2 (paragraph break)
  text = text.replace(/\n{3,}/g, '\n\n');

  // ── 18. Final trim ────────────────────────────────────────────────────────
  text = text.trim();

  return text;
}

// ── SSML Builder ──────────────────────────────────────────────────────────────
//
// Wraps clean text in SSML that:
//   • Applies the 'chat' speaking style → relaxed, human, non-robotic delivery
//   • Adds <break> pauses between paragraphs for natural pacing
//   • The msedge-tts template embeds this inside <voice><prosody>…</prosody></voice>
//     so our tags must be valid child elements of <prosody>.

/**
 * Escape characters that would break XML/SSML if left raw.
 */
function escapeXml(str) {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

/**
 * Convert cleaned plain text into an SSML fragment.
 *
 * Paragraphs (double newline) become 400 ms breaks.
 * Single newlines become 200 ms breaks.
 * The whole fragment is wrapped in <mstts:express-as style="chat">
 * so AriaNeural speaks in natural conversational style.
 */
function buildSSML(cleanText) {
  // Split on paragraph boundaries, add breaks
  const withBreaks = cleanText
    .split(/\n\n+/)
    .map(para => para.trim())
    .filter(para => para.length > 0)
    .map(para => {
      // Single newlines within a paragraph → short breath pause
      const inlineBroken = para.replace(/\n/g, ' <break time="180ms"/> ');
      return escapeXml(inlineBroken);
    })
    .join(' <break time="420ms"/> ');

  // Wrap in conversational express-as style
  // NOTE: mstts: namespace is declared on the root <speak> by msedge-tts,
  // so this tag is valid inside the template's <prosody> block.
  return `<mstts:express-as style="${MAYA_STYLE}">${withBreaks}</mstts:express-as>`;
}

// ── Core: Text → MP3 ─────────────────────────────────────────────────────────

/**
 * Convert AI response text to a natural-sounding MP3 using Edge TTS.
 *
 * Pipeline:
 *   raw AI text → preprocessForTTS → buildSSML → Edge TTS → MP3 file
 *
 * @param   {string} rawText  Raw AI response (may contain markdown).
 * @returns {Promise<string>} Filename (not path) of the generated MP3.
 */
async function textToSpeech(rawText) {
  if (!rawText || rawText.trim().length === 0) {
    throw new Error('Cannot generate TTS for empty text');
  }

  // Step 1 — strip markdown / symbols
  const cleanText = preprocessForTTS(rawText);
  console.log(`[TTS] Clean text (${cleanText.length} chars): "${cleanText.substring(0, 100)}${cleanText.length > 100 ? '…' : ''}"`);

  // Step 2 — safety truncation at sentence boundary (~1500 chars)
  const MAX_CHARS = 1500;
  const truncated = truncateAtSentence(cleanText, MAX_CHARS);

  // Step 3 — wrap in SSML for natural delivery
  const ssmlFragment = buildSSML(truncated);

  // Step 4 — synthesise
  const filename  = `maya_${uuidv4()}.mp3`;
  const filePath  = path.join(TEMP_DIR, filename);
  const startTime = Date.now();

  const tts = new MsEdgeTTS();
  // 96 kbps for noticeably cleaner audio vs 48 kbps
  await tts.setMetadata(MAYA_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  await tts.toFile(filePath, ssmlFragment);

  const elapsedMs = Date.now() - startTime;
  const sizeKB    = Math.round(fs.statSync(filePath).size / 1024);

  console.log(`[TTS] ✓ ${filename} — ${sizeKB}KB in ${elapsedMs}ms | voice=${MAYA_VOICE} style=${MAYA_STYLE}`);

  return filename;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Truncate text at a sentence boundary close to [maxChars].
 * Avoids cutting mid-sentence which would leave an awkward incomplete thought.
 */
function truncateAtSentence(text, maxChars) {
  if (text.length <= maxChars) return text;

  // Find the last sentence-ending punctuation before the limit
  const slice = text.substring(0, maxChars);
  const lastEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('.\n'),
  );

  if (lastEnd > maxChars * 0.5) {
    // Good sentence boundary found in the latter half
    return slice.substring(0, lastEnd + 1).trim();
  }

  // Fallback: hard cut at word boundary
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.substring(0, lastSpace) : slice).trim() + '.';
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

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
      } catch (_) { /* already deleted */ }
    }

    if (deleted > 0) console.log(`[TTS] 🧹 Cleaned ${deleted} old audio file(s)`);
  } catch (err) {
    console.error('[TTS] Cleanup error:', err.message);
  }
}

function deleteFile(filename) {
  try {
    const safe = path.basename(filename);
    const fp   = path.join(TEMP_DIR, safe);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (err) {
    console.error('[TTS] deleteFile error:', err.message);
  }
}

function fileExists(filename) {
  return fs.existsSync(path.join(TEMP_DIR, path.basename(filename)));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  textToSpeech,
  cleanOldFiles,
  deleteFile,
  fileExists,
  preprocessForTTS,   // exported for unit testing
  TEMP_DIR,
  MAYA_VOICE,
  MAYA_STYLE,
};
