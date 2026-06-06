/**
 * Gmail Tool — Maya Phase 4
 * Read, search, summarize, and send emails via Gmail API.
 * Requires: googleToken in request.
 */

const axios = require('axios');
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const auth  = t => ({ headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, timeout: 12000 });

function decodeBase64(str) {
  try { return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch { return ''; }
}

function extractBody(payload) {
  if (payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64(part.body.data);
    }
    for (const part of payload.parts) {
      const body = extractBody(part);
      if (body) return body;
    }
  }
  return '';
}

function getHeader(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// ── Read Latest Emails ───────────────────────────────────────────────────────

async function readLatest(googleToken, count = 3) {
  const list = await axios.get(`${GMAIL}/messages`, {
    ...auth(googleToken),
    params: { maxResults: count, labelIds: 'INBOX' },
  });
  const ids = list.data.messages || [];
  if (!ids.length) return { reply: 'Your inbox is empty.', toolUsed: 'gmail' };

  const mails = await Promise.all(ids.map(m =>
    axios.get(`${GMAIL}/messages/${m.id}`, { ...auth(googleToken), params: { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] } })
  ));

  const summaries = mails.map(r => {
    const h       = r.data.payload?.headers || [];
    const from    = getHeader(h, 'from').replace(/<.*>/, '').trim();
    const subject = getHeader(h, 'subject') || '(no subject)';
    return `From ${from}: "${subject}"`;
  });

  return {
    reply: `You have ${ids.length} recent emails. ${summaries.join('. ')}.`,
    toolUsed: 'gmail',
  };
}

// ── Read & Summarize One Email ───────────────────────────────────────────────

async function readAndSummarize(googleToken) {
  const list = await axios.get(`${GMAIL}/messages`, {
    ...auth(googleToken),
    params: { maxResults: 1, labelIds: 'INBOX' },
  });
  const id = list.data.messages?.[0]?.id;
  if (!id) return { reply: 'No emails found.', toolUsed: 'gmail' };

  const { data } = await axios.get(`${GMAIL}/messages/${id}`, { ...auth(googleToken), params: { format: 'full' } });
  const h       = data.payload?.headers || [];
  const from    = getHeader(h, 'from').replace(/<.*>/, '').trim();
  const subject = getHeader(h, 'subject') || '(no subject)';
  const body    = extractBody(data.payload).slice(0, 500).replace(/\s+/g, ' ');

  return {
    reply: `Latest email from ${from}. Subject: ${subject}. ${body ? `Content: ${body}` : ''}`.slice(0, 400),
    toolUsed: 'gmail',
  };
}

// ── Search Email ─────────────────────────────────────────────────────────────

async function searchEmail(message, googleToken) {
  const match = message.match(/(?:search|find|look for|any email from|email from|email about)\s+(.+?)(?:\s*\?|$)/i);
  const query = match ? match[1].trim() : '';
  if (!query) return readLatest(googleToken);

  const { data } = await axios.get(`${GMAIL}/messages`, {
    ...auth(googleToken),
    params: { maxResults: 5, q: query },
  });
  const ids = data.messages || [];
  if (!ids.length) return { reply: `No emails found matching "${query}".`, toolUsed: 'gmail' };

  const mails = await Promise.all(ids.slice(0, 3).map(m =>
    axios.get(`${GMAIL}/messages/${m.id}`, { ...auth(googleToken), params: { format: 'metadata', metadataHeaders: ['From', 'Subject'] } })
  ));
  const results = mails.map(r => {
    const h = r.data.payload?.headers || [];
    return `"${getHeader(h, 'subject')}" from ${getHeader(h, 'from').replace(/<.*>/, '').trim()}`;
  });
  return { reply: `Found ${ids.length} emails for "${query}": ${results.join('. ')}.`, toolUsed: 'gmail' };
}

// ── Send Email ───────────────────────────────────────────────────────────────

async function sendEmail(message, googleToken) {
  // "Send an email to Rahul saying I will be late"
  const toMatch   = message.match(/(?:to|email)\s+([A-Za-z\s]+?)(?:\s+saying|\s+with|\s+about|:|\s*$)/i);
  const bodyMatch = message.match(/(?:saying|with message|body)\s+(.+?)(?:\s*$)/i);
  const subMatch  = message.match(/(?:about|subject)\s+(.+?)(?:\s+saying|\s*$)/i);

  const to      = toMatch?.[1]?.trim() || '';
  const subject = subMatch?.[1]?.trim() || 'Message from Maya';
  const body    = bodyMatch?.[1]?.trim() || '';

  if (!to) return { reply: "Who should I send the email to? Say something like 'send email to Rahul'.", toolUsed: 'gmail' };
  if (!body) return { reply: `What should I say in the email to ${to}?`, toolUsed: 'gmail' };

  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain\r\n\r\n${body}`
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  await axios.post(`${GMAIL}/messages/send`, { raw }, auth(googleToken));
  return { reply: `Email sent to ${to}.`, toolUsed: 'gmail' };
}

// ── Main Entry ───────────────────────────────────────────────────────────────

async function fetch(message, googleToken) {
  if (!googleToken) return { reply: "I need Google account access to read your emails. Please sign in with Google.", toolUsed: 'gmail' };
  const lower = message.toLowerCase();
  try {
    if (/send|compose|write email/.test(lower)) return sendEmail(message, googleToken);
    if (/search|find|look for|any email from/.test(lower)) return searchEmail(message, googleToken);
    if (/read|open|summarize|what does|show me/.test(lower)) return readAndSummarize(googleToken);
    return readLatest(googleToken);
  } catch (err) {
    if (err.response?.status === 401) return { reply: 'Gmail access expired. Please sign in again.', toolUsed: 'gmail' };
    throw err;
  }
}

module.exports = { fetch };
