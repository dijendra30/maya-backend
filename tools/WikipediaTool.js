/**
 * Wikipedia Tool — Maya Phase 4
 *
 * Uses the Wikipedia REST API (no key required).
 * Returns a 2-3 sentence voice-ready summary.
 *
 * Strategy:
 *   1. Extract topic from the user's question
 *   2. Hit /page/summary/{title} — fast, returns a clean extract
 *   3. On 404, fall back to OpenSearch to find the closest article
 */

const axios = require('axios');

const SUMMARY_URL   = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const OPENSEARCH_URL = 'https://en.wikipedia.org/w/api.php';
const UA_HEADER     = { 'User-Agent': 'MayaAI/4.0 (personal assistant; contact@maya.ai)' };

// ── Topic Extraction ────────────────────────────────────────────────────────

const EXTRACTION_PATTERNS = [
  /^(?:who (?:is|was|were))\s+(.+?)(?:\s*\?|$)/i,
  /^(?:what (?:is|are|was|were))\s+(.+?)(?:\s*\?|$)/i,
  /^(?:tell me about|explain|describe|information about|info about|facts about)\s+(.+?)(?:\s*\?|$)/i,
  /^(?:history of|biography of|origin of|about)\s+(.+?)(?:\s*\?|$)/i,
  /^(?:what do you know about|summarize)\s+(.+?)(?:\s*\?|$)/i,
];

const STOP_SUFFIXES = /\s+(?:please|thanks|thank you|maya)$/i;

function extractTopic(message) {
  const clean = message.replace(STOP_SUFFIXES, '').trim();
  for (const re of EXTRACTION_PATTERNS) {
    const m = clean.match(re);
    if (m) {
      const topic = m[1].trim().replace(STOP_SUFFIXES, '');
      if (topic.length > 1) return topic;
    }
  }
  // Last resort: strip question mark and use the whole message
  return clean.replace(/\?$/, '').trim();
}

// ── Summary Trimmer ─────────────────────────────────────────────────────────

function voiceSummary(extract, maxSentences = 3) {
  if (!extract) return '';
  const sentences = extract.match(/[^.!?]+[.!?]+/g) || [];
  return sentences.slice(0, maxSentences).join(' ').trim();
}

// ── Fetch Helpers ───────────────────────────────────────────────────────────

async function fetchByTitle(title) {
  const encoded = encodeURIComponent(title);
  const { data } = await axios.get(`${SUMMARY_URL}/${encoded}`, {
    timeout: 8000,
    headers: UA_HEADER,
  });
  return data;
}

async function openSearch(query) {
  const { data } = await axios.get(OPENSEARCH_URL, {
    params: { action: 'opensearch', search: query, limit: 1, format: 'json', redirects: 'resolve' },
    timeout: 6000,
    headers: UA_HEADER,
  });
  return data[1]?.[0] || null; // first suggested title
}

// ── Main Fetch ──────────────────────────────────────────────────────────────

async function fetch(message) {
  const topic = extractTopic(message);

  if (!topic || topic.length < 2) {
    return {
      reply: "I need to know what topic to look up. Could you be more specific?",
      toolUsed: 'wikipedia',
    };
  }

  try {
    const data = await fetchByTitle(topic);

    if (data?.extract) {
      const summary = voiceSummary(data.extract);
      return {
        reply: summary || data.extract.slice(0, 300),
        toolUsed: 'wikipedia',
        source: `Wikipedia: ${data.title}`,
      };
    }

    return {
      reply: `I found a Wikipedia page for ${topic}, but there was no summary available.`,
      toolUsed: 'wikipedia',
    };

  } catch (err) {
    if (err.response?.status === 404) {
      // Try OpenSearch fallback
      try {
        const bestMatch = await openSearch(topic);
        if (bestMatch) {
          const data = await fetchByTitle(bestMatch);
          if (data?.extract) {
            const summary = voiceSummary(data.extract);
            return { reply: summary, toolUsed: 'wikipedia', source: `Wikipedia: ${data.title}` };
          }
        }
        return {
          reply: `I could not find Wikipedia information for "${topic}". Try rephrasing your question.`,
          toolUsed: 'wikipedia',
        };
      } catch {
        return {
          reply: `I could not find information about "${topic}" on Wikipedia.`,
          toolUsed: 'wikipedia',
        };
      }
    }
    throw err;
  }
}

module.exports = { fetch };
