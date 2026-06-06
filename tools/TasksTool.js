/**
 * Tasks Tool — Maya Phase 4
 * Google Tasks API — list, add, complete tasks.
 * Requires: googleToken in request.
 */

const axios = require('axios');
const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1';
const auth = t => ({ headers: { Authorization: `Bearer ${t}` }, timeout: 10000 });

async function getListId(googleToken) {
  const { data } = await axios.get(`${TASKS_BASE}/users/@me/lists`, auth(googleToken));
  return data.items?.[0]?.id || '@default';
}

async function readTasks(googleToken) {
  const listId = await getListId(googleToken);
  const { data } = await axios.get(`${TASKS_BASE}/lists/${listId}/tasks`, {
    ...auth(googleToken),
    params: { showCompleted: false, maxResults: 10 },
  });
  const tasks = (data.items || []).filter(t => t.status !== 'completed');
  if (!tasks.length) return { reply: 'You have no pending tasks. Great job!', toolUsed: 'tasks' };
  const list = tasks.map((t, i) => `${i + 1}. ${t.title}`).join('. ');
  return { reply: `You have ${tasks.length} pending task${tasks.length > 1 ? 's' : ''}: ${list}.`, toolUsed: 'tasks' };
}

async function addTask(message, googleToken) {
  // "add buy milk to tasks", "remind me to call doctor"
  const match = message.match(/(?:add|remind me to|create task|new task)\s+(?:to\s+)?(.+?)(?:\s+to (?:my )?tasks?)?$/i);
  const title = match ? match[1].trim() : message.replace(/add|task|remind/gi, '').trim();
  if (!title) return { reply: 'What task should I add?', toolUsed: 'tasks' };

  const listId = await getListId(googleToken);
  await axios.post(`${TASKS_BASE}/lists/${listId}/tasks`, { title }, auth(googleToken));
  return { reply: `Added "${title}" to your tasks.`, toolUsed: 'tasks' };
}

async function completeTask(message, googleToken) {
  const listId = await getListId(googleToken);
  const { data } = await axios.get(`${TASKS_BASE}/lists/${listId}/tasks`, auth(googleToken));
  const tasks   = data.items || [];
  // Find best matching task
  const query   = message.replace(/complete|done|finish|mark|tick/gi, '').trim().toLowerCase();
  const task    = tasks.find(t => t.title.toLowerCase().includes(query));
  if (!task) return { reply: `I couldn't find a task matching "${query}".`, toolUsed: 'tasks' };
  await axios.patch(`${TASKS_BASE}/lists/${listId}/tasks/${task.id}`, { status: 'completed' }, auth(googleToken));
  return { reply: `Marked "${task.title}" as complete.`, toolUsed: 'tasks' };
}

async function fetch(message, googleToken) {
  if (!googleToken) return { reply: "I need Google account access to manage your tasks. Please sign in with Google.", toolUsed: 'tasks' };
  const lower = message.toLowerCase();
  try {
    if (/complete|done|finish|mark|tick off/.test(lower)) return completeTask(message, googleToken);
    if (/add|create|new task|remind me to/.test(lower)) return addTask(message, googleToken);
    return readTasks(googleToken);
  } catch (err) {
    if (err.response?.status === 401) return { reply: 'Tasks access expired. Please sign in again.', toolUsed: 'tasks' };
    throw err;
  }
}

module.exports = { fetch };
