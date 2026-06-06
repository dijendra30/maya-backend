/**
 * Drive Tool — Maya Phase 4
 * Search Google Drive files by name/keyword.
 * Requires: googleToken in request.
 */

const axios = require('axios');
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const auth  = t => ({ headers: { Authorization: `Bearer ${t}` }, timeout: 10000 });

const MIME_LABELS = {
  'application/vnd.google-apps.document':     'Google Doc',
  'application/vnd.google-apps.spreadsheet':  'Google Sheet',
  'application/vnd.google-apps.presentation': 'Google Slides',
  'application/pdf':                           'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word Doc',
};

function extractQuery(message) {
  const match = message.match(/(?:find|search|look for|open|show|where is)\s+(?:my\s+)?(.+?)(?:\s+file|\s+document|\s+notes?|\s*\?|$)/i);
  return match ? match[1].trim() : message.replace(/drive|file|document/gi, '').trim();
}

async function fetch(message, googleToken) {
  if (!googleToken) return { reply: "I need Google account access to search your Drive. Please sign in with Google.", toolUsed: 'drive' };

  const query = extractQuery(message);
  if (!query) return { reply: 'What file should I search for?', toolUsed: 'drive' };

  try {
    const { data } = await axios.get(DRIVE, {
      ...auth(googleToken),
      params: {
        q:        `name contains '${query}' and trashed = false`,
        fields:   'files(id,name,mimeType,modifiedTime,webViewLink)',
        orderBy:  'modifiedTime desc',
        pageSize: 5,
      },
    });

    const files = data.files || [];
    if (!files.length) return { reply: `No files found for "${query}" in your Drive.`, toolUsed: 'drive' };

    const top   = files[0];
    const label = MIME_LABELS[top.mimeType] || 'File';
    const date  = new Date(top.modifiedTime).toLocaleDateString('en-IN');
    const list  = files.map((f, i) => `${i + 1}. ${f.name} (${MIME_LABELS[f.mimeType] || 'File'})`).join('. ');

    return {
      reply:       `Found ${files.length} file${files.length > 1 ? 's' : ''} for "${query}": ${list}. Opening "${top.name}".`,
      toolUsed:    'drive',
      phoneAction: top.webViewLink ? { type: 'OPEN_URL', url: top.webViewLink } : null,
    };
  } catch (err) {
    if (err.response?.status === 401) return { reply: 'Drive access expired. Please sign in again.', toolUsed: 'drive' };
    throw err;
  }
}

module.exports = { fetch };
