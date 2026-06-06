/**
 * Maya AI Tool Router — Phase 4 (Complete)
 *
 * All 12 tools:
 *   air_quality · weather · news · youtube · wikipedia
 *   music · location · vision · calendar · tasks · gmail · drive
 *
 * Priority order (checked top-to-bottom):
 *   vision > calendar > tasks > gmail > drive >
 *   air_quality > weather > music > news > location > youtube > wikipedia
 *
 * Tools that need OAuth: calendar, tasks, gmail, drive — pass googleToken
 * Tools that need GPS:   location — pass latitude/longitude
 * Tools that need image: vision   — pass imageBase64
 */

const WeatherTool    = require('../tools/WeatherTool');
const NewsTool       = require('../tools/NewsTool');
const WikipediaTool  = require('../tools/WikipediaTool');
const YouTubeTool    = require('../tools/YouTubeTool');
const AirQualityTool = require('../tools/AirQualityTool');
const MusicTool      = require('../tools/MusicTool');
const LocationTool   = require('../tools/LocationTool');
const VisionTool     = require('../tools/VisionTool');
const CalendarTool   = require('../tools/CalendarTool');
const TasksTool      = require('../tools/TasksTool');
const GmailTool      = require('../tools/GmailTool');
const DriveTool      = require('../tools/DriveTool');

// ── Trigger Tables ──────────────────────────────────────────────────────────

const TRIGGERS = {
  vision: [
    'what is this', 'what is that', 'what am i looking at', 'analyze this image',
    'read this document', 'read this text', 'what does this say', 'ocr ',
    'describe this image', 'identify this', 'what object', 'scan this',
    'what is in this photo', 'tell me about this image',
  ],
  calendar: [
    'my calendar', 'my schedule', 'my events', "what's on my calendar",
    'do i have any meeting', 'any appointments', 'create a meeting',
    'add event', 'schedule a', 'book a meeting', "today's schedule",
    'am i free', 'what do i have today', 'what do i have tomorrow',
  ],
  tasks: [
    'my tasks', 'pending tasks', 'to do', 'to-do', 'add task',
    'add to my tasks', 'remind me to', 'complete task', 'mark as done',
    'what tasks', 'my todo', 'things to do',
  ],
  gmail: [
    'my email', 'my emails', 'my inbox', 'read email', 'latest email',
    'any new email', 'send email', 'send an email', 'check email',
    'email from', 'search email', 'unread email', 'compose email',
  ],
  drive: [
    'my drive', 'google drive', 'find my file', 'find file', 'search drive',
    'find my notes', 'my notes on drive', 'open document', 'find document',
    'upsc notes', 'my pdf', 'find in drive',
  ],
  air_quality: [
    'air quality', 'aqi', 'air pollution', 'pollution level',
    'is the air clean', 'air outside', 'air today', 'pollution outside',
  ],
  weather: [
    'weather', 'temperature', 'rain', 'forecast', 'humid', 'umbrella',
    'sunny', 'cloudy', 'raining', 'storm', 'wind speed',
    'hot outside', 'cold outside', 'will it rain', 'how hot', 'how cold',
    'sunrise', 'sunset', 'outside today',
  ],
  music: [
    'i feel sad', 'i am sad', 'i\'m sad', 'feeling sad', 'feeling happy',
    'i feel happy', 'feeling low', 'need music', 'play music',
    'study music', 'workout music', 'gym music', 'chill music', 'lofi',
    'feeling relaxed', 'i feel relaxed', 'motivational music',
    'romantic music', 'songs for', 'playlist for',
    'play songs', 'play some songs', 'arijit singh', 'play bollywood',
  ],
  news: [
    'news', 'headlines', 'latest news', "what's happening",
    'current events', "today's news", 'recent news', 'breaking news', 'top stories',
  ],
  location: [
    'where am i', 'my location', 'what city am i', 'current city',
    'nearby hospital', 'nearby atm', 'nearby restaurant', 'near me',
    'find hospital', 'find atm', 'find restaurant', 'find pharmacy',
    'closest ', 'nearest ', 'directions to', 'how far is',
  ],
  youtube: [
    'on youtube', 'youtube video', 'find video', 'search video',
    'watch ', 'tutorial for', 'find tutorial', 'upsc video', 'lecture on',
  ],
  wikipedia: [
    'who is ', 'who was ', 'what is ', 'what are ', 'tell me about ',
    'explain ', 'history of ', 'biography of ', 'facts about ',
    'information about ', 'when was ', 'how does ', 'origin of ',
    'who invented ', 'who discovered ',
  ],
};

const PRIORITY = [
  'vision', 'calendar', 'tasks', 'gmail', 'drive',
  'air_quality', 'weather', 'music', 'news', 'location', 'youtube', 'wikipedia',
];

const SELF_QUESTIONS = [
  'your name', 'who are you', 'what are you', 'how are you',
  'what can you do', 'are you an ai', 'tell me about yourself',
  'your features', 'introduce yourself',
];

// ── Detector ─────────────────────────────────────────────────────────────────

function detectTool(message, hasImage) {
  const lower = message.toLowerCase();
  if (SELF_QUESTIONS.some(q => lower.includes(q))) return null;
  // Force vision if image provided
  if (hasImage) return 'vision';
  for (const toolName of PRIORITY) {
    if (TRIGGERS[toolName].some(t => lower.includes(t))) return toolName;
  }
  return null;
}

// ── Executor ──────────────────────────────────────────────────────────────────

async function executeTool(toolName, message, location, options) {
  const { googleToken, latitude, longitude, imageBase64 } = options;
  switch (toolName) {
    case 'vision':      return VisionTool.analyze(message, imageBase64);
    case 'calendar':    return CalendarTool.fetch(message, googleToken);
    case 'tasks':       return TasksTool.fetch(message, googleToken);
    case 'gmail':       return GmailTool.fetch(message, googleToken);
    case 'drive':       return DriveTool.fetch(message, googleToken);
    case 'air_quality': return AirQualityTool.fetch(location);
    case 'weather':     return WeatherTool.fetch(message, location);
    case 'music':       return MusicTool.fetch(message);
    case 'news':        return NewsTool.fetch(message);
    case 'location':    return LocationTool.fetch(message, location, { latitude, longitude });
    case 'youtube':     return YouTubeTool.search(message);
    case 'wikipedia':   return WikipediaTool.fetch(message);
    default:            return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function route(message, location = '', options = {}) {
  const hasImage = !!(options.imageBase64);
  const toolName = detectTool(message, hasImage);
  if (!toolName) return null;

  console.log(`[ToolRouter] ${toolName} | loc: ${location || '-'} | auth: ${options.googleToken ? 'yes' : 'no'} | img: ${hasImage}`);

  try {
    return await executeTool(toolName, message, location, options);
  } catch (err) {
    console.error(`[ToolRouter] ✗ ${toolName}: ${err.message}`);
    return { reply: `I tried the ${toolName} tool but hit an issue. ${err.message?.includes('401') ? 'Please sign in again.' : 'Let me answer from what I know.'}`, toolUsed: toolName, toolFailed: true };
  }
}

module.exports = { route, detectTool };
