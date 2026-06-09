/**
 * Tavily Search Tool
 * Uses the Python microservice to execute searches via Tavily API
 */

const axios = require('axios');

async function fetch(message, location, options = {}) {
  // Use the local python service
  // Adjust port if Python service runs elsewhere
  const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000';
  
  try {
    const { data } = await axios.post(`${pythonServiceUrl}/search`, {
      query: message,
      search_depth: 'basic',
      max_results: 5
    });

    if (data.results && data.results.length > 0) {
      // Summarize the results into a string block
      const resultText = data.results.map(r => `Title: ${r.title}\nContent: ${r.content}`).join('\n\n');
      return {
        reply: `Here is the search result from Tavily:\n\n${resultText}`,
        toolUsed: 'tavily',
        search_data: data.results,
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
