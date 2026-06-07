/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 *  Maya AI — Verification Guard  (Core Router)
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * CRITICAL RULE (from spec):
 *   NEVER ALLOW AN AI MODEL TO PRETEND A TASK WAS DONE.
 *   Only real results may be spoken.
 *
 * This module verifies that tool results contain actual evidence
 * before marking them as verified. Each tool has specific verification
 * rules.
 *
 * If a tool result fails verification, the response should say:
 *   "I tried to [action] but couldn't confirm it worked."
 * instead of:
 *   "Done! I've [action] for you."
 */

// ── Debug Logger ───────────────────────────────────────────────────────────
function dbg(label, data) {
  if (process.env.DEBUG_ROUTING !== 'true') return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[VerifyGuard:${ts}] ${label}`, typeof data === 'object' ? JSON.stringify(data) : (data || ''));
}

// ── Per-Tool Verification Rules ────────────────────────────────────────────
const TOOL_VERIFIERS = {

  gmail: (result) => {
    const reply = result.reply || '';
    // Must contain email-specific data (subject, sender, "email", "inbox")
    const hasEmailData = /(?:from|subject|email|inbox|unread|sent|message from)/i.test(reply);
    return {
      verified: hasEmailData && !result.toolFailed,
      evidence: hasEmailData ? 'Contains email data (sender/subject)' : 'No email data found in response',
    };
  },

  calendar: (result) => {
    const reply = result.reply || '';
    // Must contain event data or confirmation of creation
    const hasEventData = /(?:event|meeting|schedule|appointment|created|updated|deleted|no events|free|busy)/i.test(reply);
    return {
      verified: hasEventData && !result.toolFailed,
      evidence: hasEventData ? 'Contains calendar event data' : 'No calendar data found',
    };
  },

  tasks: (result) => {
    const reply = result.reply || '';
    const hasTaskData = /(?:task|to.?do|added|completed|pending|no tasks)/i.test(reply);
    return {
      verified: hasTaskData && !result.toolFailed,
      evidence: hasTaskData ? 'Contains task data' : 'No task data found',
    };
  },

  weather: (result) => {
    const reply = result.reply || '';
    // Must contain temperature or weather condition
    const hasWeatherData = /(?:\d+\s*°|celsius|fahrenheit|temperature|sunny|cloudy|rain|humid|wind|clear|overcast|fog|snow)/i.test(reply);
    return {
      verified: hasWeatherData && !result.toolFailed,
      evidence: hasWeatherData ? 'Contains temperature/condition data' : 'No weather data found',
    };
  },

  maps: (result) => {
    // Must have a URL or coordinates
    const hasUrl = !!(result.phoneAction?.url || result.phoneAction?.type === 'OPEN_URL');
    return {
      verified: hasUrl && !result.toolFailed,
      evidence: hasUrl ? 'Contains Maps URL' : 'No navigation URL found',
    };
  },

  news: (result) => {
    const reply = result.reply || '';
    // Must contain news headline indicators
    const hasNewsData = /(?:headline|report|according|news|article|breaking|source|announced)/i.test(reply);
    return {
      verified: hasNewsData && !result.toolFailed,
      evidence: hasNewsData ? 'Contains news data' : 'No news data found',
    };
  },

  wikipedia: (result) => {
    const reply = result.reply || '';
    // Must have substantive content (>50 chars)
    const hasContent = reply.length > 50 && !result.toolFailed;
    return {
      verified: hasContent,
      evidence: hasContent ? `Contains ${reply.length} chars of wiki data` : 'Insufficient wiki data',
    };
  },

  music: (result) => {
    // Must have a phoneAction or playlist URL
    const hasAction = !!(result.phoneAction?.type);
    return {
      verified: hasAction && !result.toolFailed,
      evidence: hasAction ? 'Contains music action' : 'No music action found',
    };
  },

  youtube: (result) => {
    const hasUrl = !!(result.phoneAction?.url);
    return {
      verified: hasUrl && !result.toolFailed,
      evidence: hasUrl ? 'Contains YouTube URL' : 'No YouTube URL found',
    };
  },

  air_quality: (result) => {
    const reply = result.reply || '';
    const hasAQI = /(?:aqi|air quality|index|particulate|pm2|pollution level|\d+)/i.test(reply);
    return {
      verified: hasAQI && !result.toolFailed,
      evidence: hasAQI ? 'Contains AQI data' : 'No air quality data found',
    };
  },

  location: (result) => {
    const reply = result.reply || '';
    const hasLocation = /(?:located|address|city|latitude|longitude|coordinate|place|near)/i.test(reply);
    return {
      verified: hasLocation && !result.toolFailed,
      evidence: hasLocation ? 'Contains location data' : 'No location data found',
    };
  },

  drive: (result) => {
    const reply = result.reply || '';
    const hasDriveData = /(?:file|document|found|no files|drive|folder|pdf|doc)/i.test(reply);
    return {
      verified: hasDriveData && !result.toolFailed,
      evidence: hasDriveData ? 'Contains Drive data' : 'No Drive data found',
    };
  },

  vision: (result) => {
    const reply = result.reply || '';
    // Vision responses should be substantive
    const hasVisionData = reply.length > 30 && !result.toolFailed;
    return {
      verified: hasVisionData,
      evidence: hasVisionData ? 'Contains image analysis' : 'No vision data found',
    };
  },

  capability_query: (result) => {
    return { verified: true, evidence: 'Capability query always verified' };
  },
};

// ── Main Verify Entry ──────────────────────────────────────────────────────

/**
 * Verify that a tool result contains real data.
 *
 * @param {string} toolName - The tool that produced the result
 * @param {object} result   - The tool result { reply, toolFailed, phoneAction, ... }
 * @returns {{ verified: boolean, evidence: string }}
 */
function verify(toolName, result) {
  if (!result) {
    return { verified: false, evidence: 'Null result' };
  }

  if (result.toolFailed) {
    return { verified: false, evidence: 'Tool reported failure' };
  }

  const verifier = TOOL_VERIFIERS[toolName];
  if (verifier) {
    const verification = verifier(result);
    dbg('Verify', { tool: toolName, verified: verification.verified, evidence: verification.evidence });
    return verification;
  }

  // Unknown tool — verify if reply exists and is non-empty
  const hasReply = !!(result.reply && result.reply.trim());
  return {
    verified: hasReply,
    evidence: hasReply ? 'Has non-empty reply' : 'Empty reply from unknown tool',
  };
}

/**
 * Scan an AI-generated reply for unverified success claims.
 * Returns a sanitized version if problems are found.
 *
 * @param {string} reply       - AI-generated reply text
 * @param {Array}  stepResults - Results from StepExecutor
 * @returns {{ safe: boolean, sanitizedReply: string }}
 */
function guardResponse(reply, stepResults = []) {
  if (!reply) return { safe: false, sanitizedReply: "I'm sorry, I couldn't process that." };

  // Check for false success claims on failed tools
  const failedTools = stepResults.filter(r => r.status === 'failed').map(r => r.tool);

  if (failedTools.length === 0) return { safe: true, sanitizedReply: reply };

  // Success indicators that shouldn't appear for failed tools
  const successPhrases = [
    /\b(?:done|completed|sent|created|opened|navigated|scheduled|booked|played)\b/i,
    /\b(?:i've|i have|successfully|here is|here are|found your)\b/i,
  ];

  for (const phrase of successPhrases) {
    if (phrase.test(reply)) {
      // Reply claims success but tools failed
      dbg('FalseClaim', { reply: reply.slice(0, 80), failedTools });
      const toolList = failedTools.join(', ');
      return {
        safe: false,
        sanitizedReply: `I tried to help with ${toolList} but couldn't confirm the action was completed. Please try again.`,
      };
    }
  }

  return { safe: true, sanitizedReply: reply };
}

module.exports = { verify, guardResponse };
