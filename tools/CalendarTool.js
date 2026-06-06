/**
 * Calendar Tool — Maya Phase 4
 *
 * Reads and creates Google Calendar events using the user's OAuth token.
 * The token is obtained on Android via Google Sign-In and passed in the request.
 *
 * Requires: googleToken in the request body (no server-side key needed).
 */

const axios = require('axios');

const CAL_BASE  = 'https://www.googleapis.com/calendar/v3/calendars/primary';
const CAL_EVENTS = `${CAL_BASE}/events`;

function authHeader(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ── Read Events ─────────────────────────────────────────────────────────────

async function readEvents(message, googleToken) {
  const lower = message.toLowerCase();

  // Date range
  const now       = new Date();
  let timeMin     = new Date(now); timeMin.setHours(0, 0, 0, 0);
  let timeMax     = new Date(now); timeMax.setHours(23, 59, 59, 999);
  let dayLabel    = 'today';

  if (/tomorrow/.test(lower)) {
    timeMin.setDate(timeMin.getDate() + 1);
    timeMax.setDate(timeMax.getDate() + 1);
    dayLabel = 'tomorrow';
  } else if (/this week|week/.test(lower)) {
    timeMax.setDate(timeMax.getDate() + 7);
    dayLabel = 'this week';
  }

  try {
    const { data } = await axios.get(CAL_EVENTS, {
      headers: authHeader(googleToken),
      params: {
        timeMin:      timeMin.toISOString(),
        timeMax:      timeMax.toISOString(),
        singleEvents: true,
        orderBy:      'startTime',
        maxResults:   10,
      },
      timeout: 10000,
    });

    const items = data.items || [];
    if (items.length === 0) {
      return { reply: `You have no events scheduled for ${dayLabel}.`, toolUsed: 'calendar' };
    }

    const eventList = items.map(e => {
      const start = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'All day';
      return `${e.summary} at ${start}`;
    }).join('. ');

    return {
      reply: `You have ${items.length} event${items.length > 1 ? 's' : ''} ${dayLabel}: ${eventList}.`,
      toolUsed: 'calendar',
    };
  } catch (err) {
    if (err.response?.status === 401) return { reply: 'Calendar access expired. Please sign in again.', toolUsed: 'calendar' };
    throw err;
  }
}

// ── Create Event ─────────────────────────────────────────────────────────────

async function createEvent(message, googleToken) {
  // Extract: "create a meeting tomorrow at 4 PM", "add dentist on Friday at 10 AM"
  const titleMatch = message.match(/(?:meeting|event|appointment|reminder|add|create|schedule)\s+(?:a\s+|an\s+)?(.+?)(?:\s+(?:tomorrow|today|on\s+\w+|\d+\s+\w+)|\s+at\s+)/i);
  const title      = titleMatch ? titleMatch[1].trim() : 'New Event';

  const timeMatch = message.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  const hour      = timeMatch ? (timeMatch[3].toLowerCase() === 'pm' && timeMatch[1] !== '12'
    ? parseInt(timeMatch[1]) + 12 : parseInt(timeMatch[1])) : 10;
  const minute    = timeMatch?.[2] ? parseInt(timeMatch[2]) : 0;

  const start = new Date();
  if (/tomorrow/.test(message.toLowerCase())) start.setDate(start.getDate() + 1);
  start.setHours(hour, minute, 0, 0);

  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  try {
    await axios.post(CAL_EVENTS, {
      summary: title,
      start:   { dateTime: start.toISOString() },
      end:     { dateTime: end.toISOString() },
    }, { headers: authHeader(googleToken), timeout: 10000 });

    const timeStr = start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return {
      reply:    `Done! "${title}" has been added to your calendar at ${timeStr}.`,
      toolUsed: 'calendar',
    };
  } catch (err) {
    if (err.response?.status === 401) return { reply: 'Calendar access expired. Please sign in again.', toolUsed: 'calendar' };
    throw err;
  }
}

// ── Update Event ────────────────────────────────────────────────────────────

async function updateEvent(message, googleToken) {
  const lower = message.toLowerCase();

  // Extract event name: "reschedule team meeting to 4 PM", "move standup to tomorrow at 10 AM"
  const nameMatch = message.match(/(?:reschedule|change|move|update)\s+(?:my\s+)?(?:meeting\s+)?(.+?)\s+(?:to|at)\s+/i);
  const eventName = nameMatch ? nameMatch[1].trim() : null;

  if (!eventName) {
    return { reply: "Which event do you want to update? Please mention the event name.", toolUsed: 'calendar' };
  }

  // Extract new time
  const timeMatch = message.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  const hour = timeMatch ? (timeMatch[3].toLowerCase() === 'pm' && timeMatch[1] !== '12'
    ? parseInt(timeMatch[1]) + 12 : parseInt(timeMatch[1])) : null;
  const minute = timeMatch?.[2] ? parseInt(timeMatch[2]) : 0;

  // Search for existing event
  const now = new Date();
  const timeMin = new Date(now); timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(now); timeMax.setDate(timeMax.getDate() + 7);

  try {
    const { data } = await axios.get(CAL_EVENTS, {
      headers: authHeader(googleToken),
      params: {
        q: eventName,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 5,
      },
      timeout: 10000,
    });

    const items = data.items || [];
    const target = items.find(e =>
      e.summary && e.summary.toLowerCase().includes(eventName.toLowerCase())
    );

    if (!target) {
      return { reply: `I couldn't find an event named "${eventName}" in the next 7 days.`, toolUsed: 'calendar' };
    }

    // Build update payload
    const updateBody = {};
    if (hour !== null) {
      const newStart = new Date(target.start.dateTime || target.start.date);
      if (/tomorrow/.test(lower)) newStart.setDate(newStart.getDate() + 1);
      newStart.setHours(hour, minute, 0, 0);
      const newEnd = new Date(newStart);
      newEnd.setHours(newEnd.getHours() + 1);
      updateBody.start = { dateTime: newStart.toISOString() };
      updateBody.end = { dateTime: newEnd.toISOString() };
    }

    await axios.patch(`${CAL_EVENTS}/${target.id}`, updateBody, {
      headers: authHeader(googleToken),
      timeout: 10000,
    });

    const timeStr = updateBody.start
      ? new Date(updateBody.start.dateTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : 'the same time';
    return {
      reply: `Done! "${target.summary}" has been rescheduled to ${timeStr}.`,
      toolUsed: 'calendar',
    };
  } catch (err) {
    if (err.response?.status === 401) return { reply: 'Calendar access expired. Please sign in again.', toolUsed: 'calendar' };
    throw err;
  }
}

// ── Delete Event ────────────────────────────────────────────────────────────

async function deleteEvent(message, googleToken) {
  // Extract event name: "cancel team meeting", "delete standup", "remove meeting with John"
  const nameMatch = message.match(/(?:cancel|delete|remove|hatao)\s+(?:my\s+)?(?:event\s+|meeting\s+)?(.+?)(?:\s*\?|$)/i);
  const eventName = nameMatch ? nameMatch[1].trim() : null;

  if (!eventName) {
    return { reply: "Which event do you want to cancel? Please mention the event name.", toolUsed: 'calendar' };
  }

  // Search for existing event
  const now = new Date();
  const timeMin = new Date(now); timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(now); timeMax.setDate(timeMax.getDate() + 7);

  try {
    const { data } = await axios.get(CAL_EVENTS, {
      headers: authHeader(googleToken),
      params: {
        q: eventName,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 5,
      },
      timeout: 10000,
    });

    const items = data.items || [];
    const target = items.find(e =>
      e.summary && e.summary.toLowerCase().includes(eventName.toLowerCase())
    );

    if (!target) {
      return { reply: `I couldn't find an event named "${eventName}" in the next 7 days.`, toolUsed: 'calendar' };
    }

    await axios.delete(`${CAL_EVENTS}/${target.id}`, {
      headers: authHeader(googleToken),
      timeout: 10000,
    });

    return {
      reply: `Done! "${target.summary}" has been removed from your calendar.`,
      toolUsed: 'calendar',
    };
  } catch (err) {
    if (err.response?.status === 401) return { reply: 'Calendar access expired. Please sign in again.', toolUsed: 'calendar' };
    throw err;
  }
}

// ── Main Entry ───────────────────────────────────────────────────────────────

async function fetch(message, googleToken) {
  if (!googleToken) {
    return { reply: "I need Google account access to check your calendar. Please sign in with Google in Maya's settings.", toolUsed: 'calendar' };
  }
  const lower = message.toLowerCase();
  // Check update/delete intents before create/read
  if (/reschedule|change\s+(?:my\s+)?meeting|move\s+(?:my\s+)?meeting|update\s+(?:my\s+)?meeting|update\s+event/.test(lower)) return updateEvent(message, googleToken);
  if (/cancel|delete\s+(?:my\s+)?(?:event|meeting)|remove\s+(?:my\s+)?(?:event|meeting)|hatao\s+meeting/.test(lower)) return deleteEvent(message, googleToken);
  if (/create|add|schedule|new event|set up meeting|book/.test(lower)) return createEvent(message, googleToken);
  return readEvents(message, googleToken);
}

module.exports = { fetch };
