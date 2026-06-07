/**
 * Maya AI Tool Router — Phase 4/5
 *
 * Priority order (checked top-to-bottom):
 *   vision > calendar > tasks > gmail > drive >
 *   air_quality > weather > music > news > location > youtube > wikipedia
 *
 * Rule-based detection runs first; LLM fallback only when confidence is low.
 * Tier 3 is NOT implemented.
 */

const WeatherTool     = require('../tools/WeatherTool');
const NewsTool        = require('../tools/NewsTool');
const WikipediaTool   = require('../tools/WikipediaTool');
const YouTubeTool     = require('../tools/YouTubeTool');
const AirQualityTool  = require('../tools/AirQualityTool');
const MusicTool       = require('../tools/MusicTool');
const LocationTool    = require('../tools/LocationTool');
const VisionTool      = require('../tools/VisionTool');
const CalendarTool    = require('../tools/CalendarTool');
const TasksTool       = require('../tools/TasksTool');
const GmailTool       = require('../tools/GmailTool');
const DriveTool       = require('../tools/DriveTool');
const PermissionGuard = require('../auth/PermissionGuard');
const IntentClassifier = require('./IntentClassifier');

// ── Trigger Tables ──────────────────────────────────────────────────────────
// NOTE: Do NOT add "open music", "open settings", "open maps" etc. here.
//       Those are handled locally on Android by PhoneActionDetector before
//       the message ever reaches the backend.

const TRIGGERS = {
  vision: [
    'what is this', 'what is that', 'what am i looking at', 'analyze this image',
    'read this document', 'read this text', 'what does this say', 'ocr ',
    'describe this image', 'identify this', 'what object', 'scan this',
    'what is in this photo', 'tell me about this image', 'ye kya hai', 'dekhao', 'padho ye',
  ],
  calendar: [
    'my calendar', 'my schedule', 'my events', "what's on my calendar",
    'do i have any meeting', 'any appointments', 'create a meeting',
    'add event', 'schedule a', 'book a meeting', "today's schedule",
    'am i free', 'what do i have today', 'what do i have tomorrow',
    'mera schedule', 'meeting hai kya', 'kal ka plan', 'aaj kya hai',
    'cancel meeting', 'reschedule', 'delete event', 'change meeting', 'move my meeting', 'hatao meeting',
  ],
  tasks: [
    'my tasks', 'pending tasks', 'to do', 'to-do', 'add task',
    'add to my tasks', 'remind me to', 'complete task', 'mark as done',
    'what tasks', 'my todo', 'things to do', 'kaam', 'yaad dila', 'pending kaam', 'karne hain',
  ],
  gmail: [
    'my email', 'my emails', 'my inbox', 'read email', 'latest email',
    'any new email', 'send email', 'send an email', 'check email',
    'email from', 'search email', 'unread email', 'compose email',
    'email padho', 'mail bhejo', 'inbox dekho', 'email aaya',
  ],
  drive: [
    'my drive', 'google drive', 'find my file', 'find file', 'search drive',
    'find my notes', 'my notes on drive', 'open document', 'find document',
    'upsc notes', 'my pdf', 'find in drive', 'file dhundho', 'notes dhundho', 'drive mein',
  ],
  air_quality: [
    'air quality', 'aqi', 'air pollution', 'pollution level',
    'is the air clean', 'air outside', 'air today', 'pollution outside',
    'hawa kaisi', 'pradushan', 'pollution kitna',
  ],
  weather: [
    'weather', 'temperature', 'rain', 'forecast', 'humid', 'umbrella',
    'sunny', 'cloudy', 'raining', 'storm', 'wind speed',
    'hot outside', 'cold outside', 'will it rain', 'how hot', 'how cold',
    'sunrise', 'sunset', 'outside today',
    'mausam', 'barish', 'baarish', 'garmi', 'thand', 'dhoop', 'chhata', 'mausam kaisa',
  ],
  music: [
    'i feel sad', 'i am sad', "i'm sad", 'feeling sad', 'feeling happy',
    'i feel happy', 'feeling low', 'need music', 'play music',
    'play songs', 'play some songs', 'play some music', 'some music',
    'start music',
    'study music', 'workout music', 'gym music', 'chill music', 'lofi',
    'feeling relaxed', 'i feel relaxed', 'motivational music',
    'romantic music', 'songs for', 'playlist for',
    'arijit singh', 'play bollywood',
    'gaana bajao', 'gaane sunao', 'sangeet', 'gana play karo', 'music bajao',
  ],
  news: [
    'news', 'headlines', 'latest news', "what's happening",
    'current events', "today's news", 'recent news', 'breaking news', 'top stories',
    'khabar', 'samachar', 'aaj ki news', 'kya ho raha hai', 'taza khabar',
  ],
  location: [
    'where am i', 'my location', 'what city am i', 'current city',
    'nearby hospital', 'nearby atm', 'nearby restaurant', 'near me',
    'find hospital', 'find atm', 'find restaurant', 'find pharmacy',
    'closest ', 'nearest ', 'directions to', 'how far is',
    'main kahan hun', 'hospital dhundho', 'paas mein', 'nazdeek',
  ],
  youtube: [
    'on youtube', 'youtube video', 'find video', 'search video',
    'watch ', 'tutorial for', 'find tutorial', 'upsc video', 'lecture on',
    'video dikhao', 'tutorial dhundho', 'youtube pe',
  ],
  wikipedia: [
    'who is ', 'who was ', 'what is ', 'what are ', 'tell me about ',
    'explain ', 'history of ', 'biography of ', 'facts about ',
    'information about ', 'when was ', 'how does ', 'origin of ',
    'who invented ', 'who discovered ',
    'kaun hai', 'kaun tha', 'kya hai', 'batao', 'itihas',
  ],
};

const CAPABILITY_QUERIES = [
  'what can you access', 'what tools do you have', 'what are you connected to',
  'what accounts are connected', 'what do you have access to',
  'which tools are available', 'show connected accounts', 'tool status',
  'what permissions do you have', 'what can you do with my account',
];

const PRIORITY = [
  'vision', 'calendar', 'tasks', 'gmail', 'drive',
  'air_quality', 'weather', 'music', 'news', 'location', 'youtube', 'wikipedia',
];

const SELF_QUESTIONS = [
  'your name', 'who are you', 'what are you', 'how are you',
  'what can you do', 'are you an ai', 'tell me about yourself',
  'your features', 'introduce yourself', 'tumhara naam', 'tum kaun ho', 'kya kar sakti ho',
];

// ── Tier 1: Rule-based Detection ─────────────────────────────────────────────

function detectToolByKeywords(message, hasImage) {
  const lower = message.toLowerCase();
  if (SELF_QUESTIONS.some(q => lower.includes(q))) return null;
  if (CAPABILITY_QUERIES.some(q => lower.includes(q))) return 'capability_query';
  if (hasImage) return 'vision';
  for (const toolName of PRIORITY) {
    if (TRIGGERS[toolName].some(t => lower.includes(t))) return toolName;
  }
  return null;
}

// ── Tier 2: LLM Fallback (only when Tier 1 is inconclusive) ─────────────────

async function detectTool(message, hasImage) {
  const keywordTool = detectToolByKeywords(message, hasImage);
  if (keywordTool) return keywordTool;

  // LLM fallback — 2s timeout, cached
  const llmTool = await IntentClassifier.classify(message);
  if (llmTool) return llmTool;

  return null;
}

// ── Capability Query Handler ─────────────────────────────────────────────────

function buildCapabilityReply(userId, authStatus) {
  const ToolRegistry  = require('../auth/ToolRegistry');
  const allTools      = ToolRegistry.getAllTools();
  const publicTools   = allTools.filter(t => !t.requiresAuth).map(t => t.label);
  const googleTools   = allTools.filter(t => t.authProvider === 'google').map(t => t.label);

  const googleConnected  = authStatus?.google?.connected;
  const spotifyConnected = authStatus?.spotify?.connected;

  let reply = `Here's what I can access right now:\n\n`;
  reply += `Always available: ${publicTools.join(', ')}.\n\n`;

  if (googleConnected) {
    reply += `Google account connected (${authStatus.google.email || 'linked'}): ${googleTools.join(', ')}.\n\n`;
  } else {
    reply += `Google tools locked (${googleTools.join(', ')}) — connect your Google account to enable these.\n\n`;
  }

  if (spotifyConnected) {
    reply += `Spotify connected: Spotify Access.\n\n`;
  } else {
    reply += `Spotify not connected — connect to enable music control.\n\n`;
  }

  reply += `I only access tools you have explicitly authorized.`;
  return reply;
}

// ── Tool Executor ─────────────────────────────────────────────────────────────

async function executeTool(toolName, message, location, options) {
  const { latitude, longitude, imageBase64, extractedEntities } = options;
  switch (toolName) {
    case 'vision':      return VisionTool.analyze(message, imageBase64);
    case 'calendar':    return CalendarTool.fetch(message, options._resolvedToken);
    case 'tasks':       return TasksTool.fetch(message, options._resolvedToken);
    case 'gmail':       return GmailTool.fetch(message, options._resolvedToken);
    case 'drive':       return DriveTool.fetch(message, options._resolvedToken);
    case 'air_quality': return AirQualityTool.fetch(location);
    case 'weather':     return WeatherTool.fetch(message, extractedEntities?.city || location);
    case 'music':       return MusicTool.fetch(message);
    case 'news':        return NewsTool.fetch(message);
    case 'location':    return LocationTool.fetch(message, location, { latitude, longitude });
    case 'youtube':     return YouTubeTool.search(message);
    // Phase 4: if Android already extracted the topic, pass it directly so Wikipedia
    // searches "Quantum Engineering" instead of the whole sentence.
    case 'wikipedia':   return WikipediaTool.fetch(extractedEntities?.topic || message);
    default:            return null;
  }
}

// ── Main Router ───────────────────────────────────────────────────────────────

async function route(message, location = '', options = {}) {
  const hasImage = !!(options.imageBase64);
  const toolName = await detectTool(message, hasImage);
  if (!toolName) return null;

  // Capability query — no tool execution, just status reply
  if (toolName === 'capability_query') {
    const TokenStore = require('../auth/TokenStore');
    const userId     = options.userId || 'default';
    const authStatus = TokenStore.getAuthStatus(userId);
    return {
      reply:        buildCapabilityReply(userId, authStatus),
      toolUsed:     'capability_query',
      toolVerified: true,
    };
  }

  const userId = options.userId || 'default';
  console.log(`[ToolRouter] ${toolName} | user=${userId} | loc=${location || '-'} | clientToken=${!!options.googleToken} | img=${hasImage}`);

  // ── Permission check (Tier 1: server token → Tier 2: client token → block) ──
  const permission = await PermissionGuard.guard(toolName, userId, options.googleToken || null);

  if (!permission.allowed) {
    console.log(`[ToolRouter] ✗ ${toolName} blocked (${permission.reason}) for user ${userId}`);
    return {
      reply:         permission.message,
      toolUsed:      toolName,
      authRequired:  true,
      authProvider:  permission.provider,
      connectAction: permission.connectAction,
      toolFailed:    false,
      toolVerified:  false,
    };
  }

  // Inject the resolved token (server-side or client-passed)
  options._resolvedToken = permission.token;

  try {
    const result = await executeTool(toolName, message, location, options);

    // Verify tool returned real data before replying
    if (!result || !result.reply) {
      console.error(`[ToolRouter] ✗ ${toolName} returned empty result`);
      return {
        reply:        `I tried to use the ${toolName} tool but it returned no data.`,
        toolUsed:     toolName,
        toolFailed:   true,
        toolVerified: false,
      };
    }

    // Mark as verified — real data was retrieved
    result.toolVerified = true;
    return result;

  } catch (err) {
    console.error(`[ToolRouter] ✗ ${toolName} threw: ${err.message}`);
    const is401 = err.response?.status === 401 || err.message?.includes('401');
    return {
      reply: is401
        ? `My access to your ${permission.toolLabel} has expired. Please reconnect your ${permission.provider} account.`
        : `I tried the ${toolName} tool but hit an error. Let me answer from what I know instead.`,
      toolUsed:     toolName,
      toolFailed:   true,
      toolVerified: false,
      ...(is401 ? {
        authRequired:  true,
        authProvider:  permission.provider,
        connectAction: PermissionGuard.buildConnectAction(permission.provider),
      } : {}),
    };
  }
}

module.exports = { route, detectTool };
