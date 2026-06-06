/**
 * News Tool — Maya Phase 4
 *
 * Uses NewsAPI to fetch top headlines and topic-specific news.
 * Returns a voice-ready reply — no LLM needed for news queries.
 *
 * Env vars required:
 *   NEWS_API_KEY  — https://newsapi.org
 */

const axios = require('axios');

const HEADLINES_URL   = 'https://newsapi.org/v2/top-headlines';
const EVERYTHING_URL  = 'https://newsapi.org/v2/everything';

// ── Intent Helpers ──────────────────────────────────────────────────────────

function extractCategory(lower) {
  if (/\b(?:tech|technology|ai|artificial intelligence|software|gadget)\b/.test(lower)) return 'technology';
  if (/\b(?:business|economy|market|stocks?|finance|gdp)\b/.test(lower)) return 'business';
  if (/\b(?:sport|cricket|football|ipl|nba|fifa|hockey)\b/.test(lower)) return 'sports';
  if (/\b(?:health|medical|covid|vaccine|disease|virus)\b/.test(lower)) return 'health';
  if (/\b(?:science|space|nasa|isro|research)\b/.test(lower)) return 'science';
  if (/\b(?:entertainment|bollywood|movie|film|celebrity)\b/.test(lower)) return 'entertainment';
  if (/\b(?:politic|government|election|parliament|minister)\b/.test(lower)) return 'general';
  return null;
}

function extractSearchQuery(message) {
  // "news about Modi", "latest AI news", "news on Russia"
  const patterns = [
    /(?:news about|news on|about)\s+(.+?)(?:\s*\?|$)/i,
    /(?:latest|recent|current)\s+(.+?)\s+(?:news|headlines|updates?)/i,
    /(.+?)\s+(?:news|headlines|updates?)/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m) {
      const q = m[1].trim();
      if (q.length > 1 && !/^(?:the|a|an|any|some|all|top|my)$/i.test(q)) return q;
    }
  }
  return null;
}

// ── Voice Formatter ─────────────────────────────────────────────────────────

function formatArticles(articles, category) {
  const items = articles.slice(0, 4);

  if (items.length === 0) return null;

  if (items.length === 1) {
    return `Here is the latest: ${items[0].title}.`;
  }

  const label = category
    ? `${category.charAt(0).toUpperCase() + category.slice(1)} headlines`
    : 'Top headlines';

  const parts = items.map((a, i) => `${i + 1}. ${a.title}`);
  return `${label}: ${parts.join('. ')}`;
}

// ── Main Fetch ──────────────────────────────────────────────────────────────

async function fetch(message) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return {
      reply: "News API key is not set up. Please add NEWS_API_KEY to the backend environment.",
      toolUsed: 'news',
    };
  }

  const lower    = message.toLowerCase();
  const query    = extractSearchQuery(message);
  const category = extractCategory(lower);

  try {
    let articles;

    if (query && query.length > 2 && !/^(?:headlines|news|updates|stories)$/i.test(query)) {
      // Topic-specific search
      const { data } = await axios.get(EVERYTHING_URL, {
        params: {
          q: query,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 5,
          apiKey,
        },
        timeout: 8000,
      });
      articles = (data.articles || []).filter(a => a.title && !a.title.includes('[Removed]'));

    } else {
      // Top headlines (India first)
      const params = { country: 'in', pageSize: 5, apiKey };
      if (category) params.category = category;
      const { data } = await axios.get(HEADLINES_URL, { params, timeout: 8000 });
      articles = (data.articles || []).filter(a => a.title && !a.title.includes('[Removed]'));

      // Fallback: global headlines if India returns few results
      if (articles.length < 2) {
        const fallback = await axios.get(HEADLINES_URL, {
          params: { language: 'en', pageSize: 5, apiKey, ...(category ? { category } : {}) },
          timeout: 8000,
        });
        articles = (fallback.data.articles || []).filter(a => a.title && !a.title.includes('[Removed]'));
      }
    }

    const reply = formatArticles(articles, category);
    if (!reply) {
      return { reply: "I could not find any recent news for that topic right now.", toolUsed: 'news' };
    }

    return { reply, toolUsed: 'news' };

  } catch (err) {
    if (err.response?.status === 401) {
      return { reply: 'News API key is invalid. Please check NEWS_API_KEY.', toolUsed: 'news' };
    }
    if (err.response?.status === 426) {
      return { reply: 'Free NewsAPI plan only works on localhost. Please use a paid key for the live server.', toolUsed: 'news' };
    }
    throw err;
  }
}

module.exports = { fetch };
