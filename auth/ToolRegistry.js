/**
 * Maya AI — Tool Registry
 * Centralized source-of-truth for every tool Maya can use.
 */

const TOOL_REGISTRY = {
  // ── Public / No-Auth Tools ─────────────────────────────────────────────────
  weather: {
    id:           'weather',
    label:        'Weather',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Real-time weather, temperature, and forecast.',
    icon:         '🌤️',
  },
  news: {
    id:           'news',
    label:        'News',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Top headlines and breaking news.',
    icon:         '📰',
  },
  wikipedia: {
    id:           'wikipedia',
    label:        'Wikipedia',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Encyclopedia knowledge and factual lookups.',
    icon:         '📖',
  },
  youtube: {
    id:           'youtube',
    label:        'YouTube Search',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Search and find YouTube videos.',
    icon:         '▶️',
  },
  music: {
    id:           'music',
    label:        'Music',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Mood-based and artist music search. Opens Spotify, YouTube Music, or YouTube.',
    icon:         '🎵',
  },
  air_quality: {
    id:           'air_quality',
    label:        'Air Quality',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'AQI levels and pollution data.',
    icon:         '💨',
  },
  location: {
    id:           'location',
    label:        'Location',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Reverse geocoding and nearby places search.',
    icon:         '📍',
  },
  vision: {
    id:           'vision',
    label:        'Vision',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Image analysis and OCR via Gemini Vision.',
    icon:         '👁️',
  },
  maps: {
    id:           'maps',
    label:        'Maps / Geocoding',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Location lookup, nearby places, and directions.',
    icon:         '🗺️',
  },
  movies: {
    id:           'movies',
    label:        'Movie Search (TMDB)',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Search movies, TV shows, and entertainment info.',
    icon:         '🎬',
  },
  timezone: {
    id:           'timezone',
    label:        'Time Zone',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Current time in any city or time zone.',
    icon:         '🕐',
  },
  tavily: {
    id:           'tavily',
    label:        'Tavily Web Search',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Real-time web search and current events.',
    icon:         '🌐',
  },

  // ── Device Tools (local, no OAuth) ────────────────────────────────────────
  device_actions: {
    id:           'device_actions',
    label:        'Device Actions',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Flashlight, alarms, volume, app launcher.',
    icon:         '📱',
  },
  contacts: {
    id:           'contacts',
    label:        'Contacts Access',
    installed:    true,
    requiresAuth: false,
    authProvider: 'none',
    scopes:       [],
    description:  'Read and search on-device contacts.',
    icon:         '👤',
  },

  // ── Google OAuth Tools ────────────────────────────────────────────────────
  calendar: {
    id:           'calendar',
    label:        'Calendar Access',
    installed:    true,
    requiresAuth: true,
    authProvider: 'google',
    scopes:       ['https://www.googleapis.com/auth/calendar'],
    description:  'Read and create Google Calendar events.',
    icon:         '📅',
  },
  gmail: {
    id:           'gmail',
    label:        'Gmail Access',
    installed:    true,
    requiresAuth: true,
    authProvider: 'google',
    scopes:       ['https://www.googleapis.com/auth/gmail.modify'],
    description:  'Read, search, and send Gmail messages.',
    icon:         '📧',
  },
  drive: {
    id:           'drive',
    label:        'Drive Access',
    installed:    true,
    requiresAuth: true,
    authProvider: 'google',
    scopes:       ['https://www.googleapis.com/auth/drive.file'],
    description:  'Search and open Google Drive files.',
    icon:         '📁',
  },
  tasks: {
    id:           'tasks',
    label:        'Tasks Access',
    installed:    true,
    requiresAuth: true,
    authProvider: 'google',
    scopes:       ['https://www.googleapis.com/auth/tasks'],
    description:  'Manage Google Tasks — add, read, complete.',
    icon:         '✅',
  },

  // ── Spotify OAuth ─────────────────────────────────────────────────────────
  spotify: {
    id:           'spotify',
    label:        'Spotify Access',
    installed:    true,
    requiresAuth: true,
    authProvider: 'spotify',
    scopes:       ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'],
    description:  'Control Spotify playback and search music.',
    icon:         '🎵',
  },
};

function getTool(toolId) {
  return TOOL_REGISTRY[toolId] || null;
}

function getAllTools() {
  return Object.values(TOOL_REGISTRY);
}

function getToolsByProvider(provider) {
  return getAllTools().filter(t => t.authProvider === provider);
}

function getAuthRequiredTools(provider = null) {
  return getAllTools().filter(t => t.requiresAuth && (!provider || t.authProvider === provider));
}

function requiresAuth(toolId) {
  const tool = getTool(toolId);
  return tool ? tool.requiresAuth : false;
}

module.exports = {
  TOOL_REGISTRY,
  getTool,
  getAllTools,
  getToolsByProvider,
  getAuthRequiredTools,
  requiresAuth,
};
