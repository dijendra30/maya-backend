/**
 * Maya AI — Tool Registry
 * Centralized source-of-truth for every tool Maya can use.
 *
 * Each tool tracks:
 *   installed    – built into this Maya instance
 *   requiresAuth – needs OAuth before use
 *   authProvider – which OAuth provider (google | spotify | none)
 *   scopes       – OAuth permission scopes required
 *   description  – human-readable description
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

/**
 * Get a single tool entry.
 * @param {string} toolId
 * @returns {object|null}
 */
function getTool(toolId) {
  return TOOL_REGISTRY[toolId] || null;
}

/**
 * Get all tools.
 * @returns {object[]}
 */
function getAllTools() {
  return Object.values(TOOL_REGISTRY);
}

/**
 * Get all tools for a given auth provider.
 * @param {string} provider – 'google' | 'spotify' | 'none'
 * @returns {object[]}
 */
function getToolsByProvider(provider) {
  return getAllTools().filter(t => t.authProvider === provider);
}

/**
 * Get tools that require auth and match a provider.
 */
function getAuthRequiredTools(provider = null) {
  return getAllTools().filter(t => t.requiresAuth && (!provider || t.authProvider === provider));
}

/**
 * Check if a tool requires authentication.
 * @param {string} toolId
 * @returns {boolean}
 */
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
