/**
 * Tavily Search Tool
 * Uses the official @tavily/core Node.js SDK to execute searches
 */

const { tavily } = require('@tavily/core');

async function fetch(message, location, options = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.error('[TavilyTool] TAVILY_API_KEY is not defined in .env');
    return {
      reply: "Search is currently offline (missing API key).",
      toolUsed: 'tavily',
      toolVerified: false
    };
  }

  try {
    const client = tavily({ apiKey });
    
    // Perform search
    const response = await client.search(message, {
      searchDepth: 'basic',
      maxResults: 5
    });

    if (response.results && response.results.length > 0) {
      // Summarize the results into a string block
      const resultText = response.results.map(r => `Title: ${r.title}\nContent: ${r.content}`).join('\n\n');
      return {
        reply: `Here is the search result from Tavily:\n\n${resultText}`,
        toolUsed: 'tavily',
        search_data: response.results,
        toolVerified: true
      };
    } else {
      return {
        reply: "I couldn't find any relevant results for that search.",
        toolUsed: 'tavily',
        toolVerified: false
      };
    }
  } catch (err) {
    console.error('[TavilyTool] Error:', err.message);
    return {
      reply: "There was an error accessing the search service.",
      toolUsed: 'tavily',
      toolVerified: false
    };
  }
}

module.exports = { fetch };
