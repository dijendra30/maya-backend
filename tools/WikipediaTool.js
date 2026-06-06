/**
 * Wikipedia Tool — Maya Phase 4
 *
 * Uses the Wikipedia REST API (no key required).
 * Returns a 2-3 sentence voice-ready summary.
 *
 * Strategy:
 *   1. Extract topic from the user's question (strip question words, "the", articles)
 *   2. Hit /page/summary/{title} — fast, returns a clean extract
 *   3. On 404, fall back to OpenSearch to find the closest article
 */

const axios = require('axios');

const SUMMARY_URL    = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const OPENSEARCH_URL = 'https://en.wikipedia.org/w/api.php';
const UA_HEADER      = { 'User-Agent': 'MayaAI/4.0 (personal assistant; contact@maya.ai)' };

// ── Topic Extraction ────────────────────────────────────────────────────────

const EXTRACTION_PATTERNS = [
  /^(?:who (?:is|was|were))\s+(.+?)(?:\s*\?|$)/i,
  /^(?:what (?:is|are|was|were))\s+(.+?)(?:\s*\?|$)/i,
  /^(?:tell me about|explain|describe|information about|info about|facts about)\s+(.+?)(?:\s*\?|$)/i,
  /^(?:history of|biography of|origin of|about)\s+(.+?)(?:\s*\?|$)/i,
  /^(?:what do you know about|summarize)\s+(.+?)(?:\s*\?|$)/i,
  // Hindi / Hinglish
  /(.+?)\s+(?:kaun tha|kaun hai|kaun the|kya hai|kya tha)\s*\??$/i,
  /(.+?)\s+ke\s+(?:baare mein|bare mein)\s+(?:batao|bataiye)\s*\??$/i,
  /^(?:batao|bataiye|bataao)\s+(.+?)(?:\s*\?|$)/i,
];

const STOP_SUFFIXES  = /\s+(?:please|thanks|thank you|maya|bhai|yaar)$/i;
// "tell me" is included with a negative lookahead so:
//   "tell me about X"   → NOT stripped (pattern 2 matches it directly)
//   "tell me who is X"  → stripped to "who is X" (pattern 0 matches)
const FILLER_PHRASES = /^(?:can you tell me|tell me(?!\s+about)|do you know|hey maya|maya|please tell me|i want to know)\s+/i;

// Leading articles and filler words to strip from the final topic
const LEADING_ARTICLES = /^(?:the|a|an|some|this|that|these|those)\s+/i;

function extractTopic(message) {
  let clean = message.replace(STOP_SUFFIXES, '').trim();
  clean = clean.replace(FILLER_PHRASES, '').trim();
  clean = clean.replace(FILLER_PHRASES, '').trim();
  // Strip orphaned "about" left after filler removal
  clean = clean.replace(/^about\s+/i, '').trim();

  for (const re of EXTRACTION_PATTERNS) {
    const m = clean.match(re);
    if (m) {
      let topic = m[1].trim().replace(STOP_SUFFIXES, '');
      // Strip leading articles from extracted topic: "the Prime Minister" → "Prime Minister"
      topic = topic.replace(LEADING_ARTICLES, '').trim();
      if (topic.length > 1) return topic;
    }
  }
  // Last resort: strip question mark and leading articles, use the whole message
  return clean.replace(/\?$/, '').replace(LEADING_ARTICLES, '').trim();
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
  return data[1]?.[0] || null;
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
