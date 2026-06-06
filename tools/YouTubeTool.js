/**
 * YouTube Tool — Maya Phase 4
 *
 * Two modes:
 *   1. With YOUTUBE_API_KEY → searches the API, returns the top video URL
 *   2. Without key → builds a YouTube search URL directly (free fallback)
 *
 * Always returns a phoneAction: { type: 'OPEN_URL', url } so the Android
 * app can open YouTube immediately.
 *
 * Env vars:
 *   YOUTUBE_API_KEY  — https://console.cloud.google.com (optional)
 */

const axios = require('axios');

const YT_SEARCH_API = 'https://www.googleapis.com/youtube/v3/search';

// ── Query Builder ───────────────────────────────────────────────────────────

const COMMAND_WORDS = /\b(?:play|find|search|show me|look up|open|search for|on youtube|from youtube|watch)\b/gi;
const NOUN_WORDS    = /\b(?:video|videos|song|songs|music|audio|playlist|tutorial|tutorials|episode)\b/gi;

function buildQuery(message) {
  let q = message
    .replace(COMMAND_WORDS, '')
    .replace(NOUN_WORDS, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return q.length > 1 ? q : message.trim();
}

// ── Fallback (no API key) ───────────────────────────────────────────────────

function buildFallbackResult(message) {
  const query = buildQuery(message);
  const url   = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return {
    reply: `Searching YouTube for ${query}.`,
    toolUsed: 'youtube',
    phoneAction: { type: 'OPEN_URL', url },
  };
}

// ── API Search ──────────────────────────────────────────────────────────────

async function search(message) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const query  = buildQuery(message);

  // No key — open search URL directly
  if (!apiKey) return buildFallbackResult(message);

  try {
    const { data } = await axios.get(YT_SEARCH_API, {
      params: {
        part:       'snippet',
        q:          query,
        type:       'video',
        maxResults: 3,
        key:        apiKey,
        regionCode: 'IN',
      },
      timeout: 8000,
    });

    const items = data.items || [];
    if (items.length === 0) return buildFallbackResult(message);

    const top     = items[0];
    const videoId = top.id.videoId;
    const title   = top.snippet.title;
    const channel = top.snippet.channelTitle;
    const url     = `https://www.youtube.com/watch?v=${videoId}`;

    return {
      reply:       `Found "${title}" by ${channel}. Opening it for you.`,
      toolUsed:    'youtube',
      phoneAction: { type: 'OPEN_URL', url },
    };

  } catch (err) {
    // Quota exceeded or other API error — degrade gracefully
    console.warn(`[YouTubeTool] API error (${err.response?.status}): ${err.message}. Using URL fallback.`);
    return buildFallbackResult(message);
  }
}

module.exports = { search };
