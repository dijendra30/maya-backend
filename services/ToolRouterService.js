/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 *  Maya AI — Tool Router Service  (Core Router)
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Core Router pipeline (per spec):
 *   User → Intent Detection → Planner → Executor → Verification → Response
 *
 * Public API:
 *   detectIntent(message, hasImage, preEntities) → { tool, intent, entities, tier }
 *   executeTool(toolName, message, location, options) → tool result
 *   route(message, location, options) → combined (LEGACY, preserved for compat)
 *
 * Tiers:
 *   Tier 1 — Rule-based keyword detection (fast, zero LLM cost)
 *   Tier 2 — LLM intent classify (Gemini Flash → Groq) with entity extraction
 *
 * Tool execution:
 *   - Synchronous from user perspective (await tool, THEN generate response)
 *   - Never speak before tool finishes
 *   - Verify result before confirming success
 *   - Return actual error on failure — never hallucinate success
 *
 * Debug logging (DEBUG_ROUTING=true in .env):
 *   Detected Intent | Extracted Entities | Selected Tool
 *   Execution Result | Execution Time | Selected AI Provider | Failover Events
 *
 * IMPORTANT — Gmail fix:
 *   Android PhoneActionDetector intercepts "open gmail" → local app launch.
 *   Backend only receives read-intent gmail queries (read email, latest email, etc).
 *   This file handles those correctly.
 *
 * Maps fix:
 *   "Navigate to X" / "nearest Y" → backend returns phoneAction OPEN_URL for Maps.
 *
 * Music fix:
 *   Mood-based queries ("I feel sad play music") → MusicTool handles properly.
 *   Simple "play music" is intercepted locally by PhoneActionDetector.
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
const TavilyTool      = require('../tools/TavilyTool');
const PermissionGuard = require('../auth/PermissionGuard');
const IntentClassifier = require('./IntentClassifier');

// ── Debug Logger ───────────────────────────────────────────────────────────
function dbg(label, data) {
  if (process.env.DEBUG_ROUTING !== 'true') return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[ToolRouter:${ts}] ${label}`, typeof data === 'object' ? JSON.stringify(data) : (data || ''));
}

// ── Trigger Tables ──────────────────────────────────────────────────────────
// NOTE: "open gmail", "check gmail", "open calendar" are handled by Android
// PhoneActionDetector BEFORE reaching backend. Backend only sees read queries.

const TRIGGERS = {
  vision: [
    'what is this','what is that','what am i looking at','analyze this image',
    'read this document','read this text','what does this say','ocr ',
    'describe this image','identify this','what object','scan this',
    'what is in this photo','tell me about this image','ye kya hai','dekhao','padho ye',
  ],
  calendar: [
    'my calendar','my schedule','my events',"what's on my calendar",
    'do i have any meeting','any appointments','create a meeting','add event',
    'schedule a ','book a meeting',"today's schedule",'am i free',
    'what do i have today','what do i have tomorrow','mera schedule',
    'meeting hai kya','kal ka plan','aaj kya hai','cancel meeting',
    'reschedule','delete event','change meeting','move my meeting','hatao meeting',
    'read my calendar','show my events','list events',
  ],
  tasks: [
    'my tasks','pending tasks','to do','to-do','add task','add to my tasks',
    'remind me to','complete task','mark as done','what tasks','my todo',
    'things to do','kaam','yaad dila','pending kaam','karne hain',
  ],
  gmail: [
    'my email','my emails','my inbox','read email','read my email',
    'read unread','latest email','any new email','send email','send an email',
    'check my email','email from','search email','unread email','compose email',
    'email padho','mail bhejo','inbox dekho','email aaya','who emailed me',
    'unread emails','new emails','did i get any email','any emails today',
    'latest message in email',
  ],
  drive: [
    'my drive','google drive','find my file','find file','search drive',
    'find my notes','my notes on drive','open document','find document',
    'upsc notes','my pdf','find in drive','file dhundho','notes dhundho','drive mein',
  ],
  air_quality: [
    'air quality','aqi','air pollution','pollution level',
    'is the air clean','air outside','air today','pollution outside',
    'hawa kaisi','pradushan','pollution kitna',
  ],
  weather: [
    'weather','temperature','rain','forecast','humid','umbrella',
    'sunny','cloudy','raining','storm','wind speed','hot outside',
    'cold outside','will it rain','how hot','how cold','sunrise','sunset',
    'outside today','mausam','barish','baarish','garmi','thand','dhoop',
    'chhata','mausam kaisa',
  ],
  music: [
    'i feel sad','i am sad',"i'm sad",'feeling sad','feeling happy',
    'i feel happy','feeling low','need music','play songs','play some songs',
    'play some music','study music','workout music','gym music','chill music',
    'lofi','feeling relaxed','i feel relaxed','motivational music',
    'romantic music','songs for','playlist for','arijit singh',
    'play bollywood','gaana bajao','gaane sunao','sangeet','music bajao',
    // "play music" alone is handled by PhoneActionDetector; mood variants reach here
    'some music for me','music for studying','music for gym',
  ],
  maps: [
    'navigate to','directions to','take me to','how do i get to',
    'nearest hospital','nearest atm','nearest restaurant',
    'nearby hospital','nearby atm','nearby restaurant','near me',
    'find hospital','find atm','find restaurant','find pharmacy',
    'closest ','how far is','get directions','show me the way',
    'paas mein','nazdeek','hospital dhundho','rasta batao',
    // also location queries that need maps phoneAction
    'where am i','my location','what city am i','current city',
  ],
  news: [
    'news','headlines','latest news',"what's happening",
    'current events',"today's news",'recent news','breaking news','top stories',
    'khabar','samachar','aaj ki news','kya ho raha hai','taza khabar',
  ],
  location: [
    'where am i','my location','what city am i','current city',
    'what address am i at','geolocate',
  ],
  youtube: [
    'on youtube','youtube video','find video','search video',
    'watch ','tutorial for','find tutorial','upsc video','lecture on',
    'video dikhao','tutorial dhundho','youtube pe',
  ],
  wikipedia: [
    'who is ','who was ','tell me about ','explain ','history of ',
    'biography of ','facts about ','information about ','when was ',
    'how does ','origin of ','who invented ','who discovered ',
    'kaun hai','kaun tha','kya hai','batao','itihas',
    // "what is" is very broad, but include it for wikipedia tier-1
    'what is ','what are ',
  ],
  tavily: [
    'search the web', 'look up online', 'search online', 'google search',
    'find on the internet', 'current events', 'search tavily'
  ]
};

const CAPABILITY_QUERIES = [
  'what can you access','what tools do you have','what are you connected to',
  'what accounts are connected','what do you have access to',
  'which tools are available','show connected accounts','tool status',
  'what permissions do you have','what can you do with my account',
];

const PRIORITY = [
  'vision','calendar','tasks','gmail','drive',
  'air_quality','weather','maps','music','news','location','youtube','tavily','wikipedia',
];

const SELF_QUESTIONS = [
  'your name','who are you','what are you','how are you',
  'what can you do','are you an ai','tell me about yourself',
  'your features','introduce yourself','tumhara naam','tum kaun ho','kya kar sakti ho',
];

// ── Intent → Tool name mapping (from IntentClassifier results) ─────────────
const INTENT_TO_TOOL = {
  calendar:      'calendar',
  gmail:         'gmail',
  weather:       'weather',
  maps:          'maps',
  music:         'music',
  wikipedia:     'wikipedia',
  news:          'news',
  send_message:  null,       // handled by ConversationSlot on Android
  call_contact:  null,       // handled by PhoneActionDetector on Android
  open_app:      null,       // handled by PhoneActionDetector on Android
  google_drive:  'drive',
  device_control: null,      // handled locally on Android
  knowledge_query: null,       // spec: knowledge questions → Gemini Flash, not Wikipedia
  general_chat:   null,      // pure AI
  air_quality:   'air_quality',
  location:      'location',
  youtube:       'youtube',
  vision:        'vision',
  tasks:         'tasks',
  drive:         'drive',
  tavily:        'tavily',
};

// ── Tier 1: Rule-based Detection ───────────────────────────────────────────
function detectToolByKeywords(message, hasImage) {
  const lower = message.toLowerCase();
  if (SELF_QUESTIONS.some(q => lower.includes(q))) return null;
  if (CAPABILITY_QUERIES.some(q => lower.includes(q))) return 'capability_query';
  if (hasImage) return 'vision';
  for (const toolName of PRIORITY) {
    if (TRIGGERS[toolName] && TRIGGERS[toolName].some(t => lower.includes(t))) return toolName;
  }
  return null;
}

// ── Intent Classification (Gemini Flash → Groq fallback) ────────────────
async function detectTool(message, hasImage, preExtractedEntities) {
  const t0 = Date.now();

  // Tier 1: LLM classify with entity extraction (GEMINI FIRST)
  try {
    const result = await IntentClassifier.classify(message);
    if (result && result.intent) {
      const toolName = INTENT_TO_TOOL[result.intent];
      const mergedEntities = { ...result.entities, ...(preExtractedEntities || {}) };
      const elapsedMs = Date.now() - t0;
      dbg('Tier1:LLMMatch', { intent: result.intent, tool: toolName, entities: mergedEntities, elapsedMs });
      
      // Even if toolName is null (handled locally on Android), we return it
      return { tool: toolName !== undefined ? toolName : null, entities: mergedEntities, tier: 1, intent: result.intent };
    }
  } catch (err) {
    console.warn(`[ToolRouter] IntentClassifier error: ${err.message}`);
  }

  // Tier 2: Keyword match fallback (if LLM fails)
  const keywordTool = detectToolByKeywords(message, hasImage);
  if (keywordTool) {
    dbg('Tier2:KeywordMatch', { tool: keywordTool, elapsedMs: Date.now() - t0 });
    return { tool: keywordTool, entities: preExtractedEntities || {}, tier: 2, intent: keywordTool };
  }

  return { tool: null, entities: preExtractedEntities || {}, tier: 0, intent: null };
}

// ── Public Intent Detection API (used by Core Router chatController) ──────
/**
 * Detect intent and extract entities WITHOUT executing any tool.
 *
 * @param {string} message             - User message
 * @param {boolean} hasImage           - Whether an image is attached
 * @param {object} preExtractedEntities - Pre-extracted entities from Android
 * @returns {Promise<{ tool: string|null, intent: string|null, entities: object, tier: number }>}
 */
async function detectIntent(message, hasImage = false, preExtractedEntities = {}) {
  return detectTool(message, hasImage, preExtractedEntities);
}

// ── Capability Query Handler ───────────────────────────────────────────────
function buildCapabilityReply(userId, authStatus) {
  const ToolRegistry = require('../auth/ToolRegistry');
  const allTools     = ToolRegistry.getAllTools();
  const publicTools  = allTools.filter(t => !t.requiresAuth).map(t => t.label);
  const googleTools  = allTools.filter(t => t.authProvider === 'google').map(t => t.label);

  let reply = `Here's what I can access right now. `;
  reply    += `Always available: ${publicTools.join(', ')}. `;

  if (authStatus?.google?.connected) {
    reply += `Google account connected (${authStatus.google.email || 'linked'}): ${googleTools.join(', ')}. `;
  } else {
    reply += `Google tools locked (${googleTools.join(', ')}) — connect your Google account to enable these. `;
  }
  reply += `I only access tools you have explicitly authorized.`;
  return reply;
}

// ── Maps Tool Handler ──────────────────────────────────────────────────────
// Maps backend: returns phoneAction to open Google Maps with query/coords.
// This handles "navigate to X", "nearest hospital", "directions to Y".
async function handleMapsTool(message, location, options) {
  const lower  = message.toLowerCase();
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  // Navigate / directions
  const navMatch = message.match(/(?:navigate to|directions? to|take me to|how (?:do i get|to get) to)\s+(.+?)(?:\s*\?|$)/i);
  if (navMatch) {
    const dest     = encodeURIComponent(navMatch[1].trim());
    const mapsUrl  = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
    return {
      reply:       `Opening navigation to ${navMatch[1].trim()}.`,
      toolUsed:    'maps',
      phoneAction: { type: 'OPEN_URL', url: mapsUrl },
      toolVerified: true,
    };
  }

  // Forward to LocationTool for nearby / where-am-I queries
  return LocationTool.fetch(message, location, options);
}

// ── Tool Executor ──────────────────────────────────────────────────────────
async function executeTool(toolName, message, location, options) {
  const { latitude, longitude, imageBase64, extractedEntities } = options;

  // Use pre-extracted entities from Android + LLM-extracted entities
  const entities = extractedEntities || {};

  switch (toolName) {
    case 'vision':
      return VisionTool.analyze(message, imageBase64);

    case 'calendar':
      return CalendarTool.fetch(message, options._resolvedToken);

    case 'tasks':
      return TasksTool.fetch(message, options._resolvedToken);

    case 'gmail':
      // FIXED: Always await the full Gmail API response before returning.
      // Bug was: tool was called but Maya spoke "Checking email" before getting result.
      // Now: full synchronous await — result is returned, THEN response is generated.
      return GmailTool.fetch(message, options._resolvedToken);

    case 'drive':
      return DriveTool.fetch(message, options._resolvedToken);

    case 'air_quality':
      return AirQualityTool.fetch(location);

    case 'weather':
      // Use Android pre-extracted city first, then server-extracted, then GPS location
      return WeatherTool.fetch(message, entities.city || location);

    case 'maps':
      return handleMapsTool(message, location, options);

    case 'music':
      return MusicTool.fetch(message);

    case 'news':
      return NewsTool.fetch(message);

    case 'location':
      return LocationTool.fetch(message, location, { latitude, longitude });

    case 'youtube':
      return YouTubeTool.search(message);

    case 'tavily':
      return TavilyTool.fetch(message, location, options);

    case 'wikipedia':
      // Use Android pre-extracted topic directly — avoids re-parsing the raw sentence
      // e.g. entities.topic = "APJ Abdul Kalam" instead of "who is APJ Abdul Kalam"
      return WikipediaTool.fetch(entities.topic || message);

    default:
      return null;
  }
}

// ── Main Router ────────────────────────────────────────────────────────────

/**
 * Route a message to the correct tool, execute synchronously, verify, return.
 *
 * Flow (spec):
 *   Intent Detection → Entity Extraction → Task Planning
 *   → Tool Selection → Execution (await) → Verification → Response
 *
 * @param {string} message
 * @param {string} location      GPS-derived city name
 * @param {object} options       { userId, googleToken, latitude, longitude, imageBase64, extractedEntities }
 * @returns {Promise<object|null>}
 */
async function route(message, location = '', options = {}) {
  const t0       = Date.now();
  const hasImage = !!(options.imageBase64);
  const preEnts  = options.extractedEntities || {};

  // ── Step 1: Intent Detection + Entity Extraction ────────────────────────
  const { tool: toolName, entities: detectedEntities, tier } = await detectTool(message, hasImage, preEnts);

  // Merge all entities: pre-extracted (Android) + LLM-detected
  const mergedEntities = { ...preEnts, ...detectedEntities };
  options.extractedEntities = mergedEntities;

  dbg('Pipeline', {
    message:   message.slice(0, 80),
    intent:    toolName,
    entities:  mergedEntities,
    tier,
    location,
    userId:    options.userId,
    hasImage,
  });

  if (!toolName) {
    dbg('NoTool', 'Falling through to pure AI');
    return null;
  }

  // ── Step 2: Capability Query ────────────────────────────────────────────
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
  console.log(`[ROUTER] Selected Tool: ${toolName || 'none'} (Intent: ${detectedIntent})`);
  console.log(`[ToolRouter] ROUTE: tool=${toolName} | user=${userId} | tier=${tier} | loc=${location || '-'} | clientToken=${!!options.googleToken} | img=${hasImage} | entities=${JSON.stringify(mergedEntities)}`);

  // ── Step 3: Permission Check ────────────────────────────────────────────
  const permission = await PermissionGuard.guard(toolName, userId, options.googleToken || null);

  if (!permission.allowed) {
    const authMs = Date.now() - t0;
    console.log(`[ToolRouter] ✗ BLOCKED: ${toolName} (${permission.reason}) | user=${userId} | elapsedMs=${authMs}`);
    dbg('Blocked', { tool: toolName, reason: permission.reason });
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

  // Inject the resolved token
  options._resolvedToken = permission.token;

  // ── Step 4: Synchronous Tool Execution (WAIT for result) ────────────────
  // CRITICAL FIX: Tool execution is fully awaited before any response is sent.
  // Maya NEVER speaks "checking email" and then stops — she waits for the data.

  dbg('Executing', { tool: toolName, entities: mergedEntities });
  console.log(`[ROUTER] Tool Executed: ${toolName}`);

  let result;
  try {
    result = await executeTool(toolName, message, location, options);
  } catch (err) {
    const execMs = Date.now() - t0;
    console.error(`[ToolRouter] ✗ EXECUTION ERROR: ${toolName} threw after ${execMs}ms — ${err.message}`);
    dbg('ExecutionError', { tool: toolName, error: err.message, elapsedMs: execMs });

    const is401 = err.response?.status === 401 || err.message?.includes('401');
    return {
      reply: is401
        ? `My access to your ${permission.toolLabel} has expired. Please reconnect your ${permission.provider} account.`
        : `I tried the ${toolName} tool but encountered an error: ${err.message?.slice(0, 100) || 'unknown error'}.`,
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

  const execMs = Date.now() - t0;

  // ── Step 5: Verify Result (NEVER hallucinate success) ───────────────────
  if (!result || !result.reply) {
    console.error(`[ToolRouter] ✗ EMPTY RESULT: ${toolName} returned no data | elapsedMs=${execMs}`);
    dbg('EmptyResult', { tool: toolName, elapsedMs: execMs });
    return {
      reply:        `I tried to use ${toolName} but it returned no data. Let me try to answer from what I know.`,
      toolUsed:     toolName,
      toolFailed:   true,
      toolVerified: false,
    };
  }

  // Tool returned data — mark as verified
  result.toolVerified = !result.toolFailed;

  console.log(`[ROUTER] Tool Result: ${result.toolFailed ? 'Failed' : 'Success'} | Verified: ${result.toolVerified}`);
  console.log(`[ToolRouter] ✓ SUCCESS: ${toolName} | elapsedMs=${execMs} | verified=${result.toolVerified}`);
  dbg('Success', { tool: toolName, reply: result.reply?.slice(0, 80), elapsedMs: execMs, verified: result.toolVerified });

  return result;
}

module.exports = { route, detectTool, detectIntent, executeTool };
