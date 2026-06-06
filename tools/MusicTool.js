/**
 * Music Tool — Maya Phase 4
 *
 * Handles mood-based music + specific artist/song searches.
 * Returns a phoneAction: OPEN_URL pointing to YouTube.
 * No API key required (uses YouTube search URL).
 *
 * MusicTool handles:  mood queries, artist songs, genre music
 * YouTubeTool handles: video/tutorial searches
 */

const MOOD_PLAYLISTS = {
  sad:        'sad+songs+hindi+playlist+2024',
  heartbreak: 'heartbreak+songs+hindi+emotional',
  happy:      'happy+bollywood+songs+playlist',
  excited:    'upbeat+dance+songs+bollywood',
  relaxed:    'lofi+chill+music+playlist',
  calm:       'relaxing+music+peaceful',
  focused:    'lofi+study+music+no+lyrics',
  study:      'study+music+concentration+lofi',
  motivated:  'workout+motivation+songs+hindi',
  gym:        'gym+workout+music+pump+up',
  romantic:   'romantic+hindi+songs+playlist',
  love:       'love+songs+hindi+2024',
  sleep:      'sleep+music+calming+instrumental',
  meditation: 'meditation+music+peaceful',
};

function detectMood(lower) {
  if (/\b(?:sad|unhappy|depressed|upset|crying|low|heartbroken|broken heart)\b/.test(lower)) return 'sad';
  if (/\b(?:happy|excited|great|wonderful|celebrating|joy)\b/.test(lower)) return 'happy';
  if (/\b(?:relax|chill|calm|peaceful|unwind|rest)\b/.test(lower)) return 'relaxed';
  if (/\b(?:focus|study|concentrate|work|productive|revision)\b/.test(lower)) return 'focused';
  if (/\b(?:motivat|workout|gym|exercise|run|energy|pump)\b/.test(lower)) return 'motivated';
  if (/\b(?:romantic|love|missing|longing)\b/.test(lower)) return 'romantic';
  if (/\b(?:sleep|bedtime|night|insomnia)\b/.test(lower)) return 'sleep';
  if (/\b(?:meditat|spiritual|mindful)\b/.test(lower)) return 'meditation';
  return null;
}

function buildSearchQuery(message) {
  const lower = message.toLowerCase();
  // Remove music command words to get the search subject
  return message
    .replace(/\b(?:play|find|search|put on|start|i want to listen to|can you play)\b/gi, '')
    .replace(/\b(?:some|a|the|please|now)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() + '+songs';
}

function buildYouTubeUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

async function fetch(message) {
  const lower = message.toLowerCase();

  // 1. Mood detection — "I feel sad", "I'm happy", "need study music"
  const mood = detectMood(lower);
  if (mood) {
    const playlist = MOOD_PLAYLISTS[mood];
    const url      = buildYouTubeUrl(playlist);
    const moodName = mood.charAt(0).toUpperCase() + mood.slice(1);
    return {
      reply:       `Opening ${moodName} playlist for you.`,
      toolUsed:    'music',
      phoneAction: { type: 'OPEN_URL', url },
    };
  }

  // 2. Artist / genre search — "play Arijit Singh", "play lofi music"
  const query = buildSearchQuery(message);
  const url   = buildYouTubeUrl(query);
  return {
    reply:       `Opening ${query.replace(/\+/g, ' ')} on YouTube.`,
    toolUsed:    'music',
    phoneAction: { type: 'OPEN_URL', url },
  };
}

module.exports = { fetch, detectMood };
