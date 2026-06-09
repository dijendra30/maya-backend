/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 *  Maya AI — Planner Service  (Core Router)
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Decomposes a user request + detected intent into an ordered array
 * of executable steps.
 *
 * Spec flow:
 *   Intent Detection → PLANNER → Executor → Response Generator → TTS
 *
 * Responsibilities:
 *   - Break compound requests into multiple steps
 *   - Detect message collection mode (missing required fields)
 *   - Assign each step to server or device execution
 *   - Order steps respecting dependencies
 *
 * NEVER generates a response. NEVER executes tools.
 * Only produces a structured plan.
 */

// ── Device-side intents (handled by Android, not backend tools) ────────────
const DEVICE_INTENTS = new Set([
  'send_message', 'call_contact', 'open_app', 'device_control',
]);

// ── Intents that require message body for collection mode ──────────────────
const COLLECTION_INTENTS = {
  send_message: { requiredFields: ['recipient', 'message'], promptField: 'message', prompt: 'What should I say?' },
  call_contact: { requiredFields: ['recipient'], promptField: 'recipient', prompt: 'Who should I call?' },
  create_event: { requiredFields: ['title', 'time'], promptField: 'title', prompt: 'What should I name this event?' },
};

// ── Tool → action mapping for step schema ──────────────────────────────────
const TOOL_ACTIONS = {
  weather:      'fetch_weather',
  calendar:     'fetch_calendar',
  tasks:        'fetch_tasks',
  gmail:        'fetch_gmail',
  drive:        'search_drive',
  air_quality:  'fetch_air_quality',
  news:         'fetch_news',
  wikipedia:    'fetch_wikipedia',
  youtube:      'search_youtube',
  music:        'fetch_music',
  maps:         'navigate',
  location:     'fetch_location',
  vision:       'analyze_image',
  tavily:       'search_web',
  // device-side
  send_message:   'send_message',
  call_contact:   'call',
  open_app:       'open_app',
  device_control: 'device_action',
};

// ── App package constants (mirror Android ToolAction.kt) ───────────────────
const APP_PACKAGES = {
  whatsapp:  'com.whatsapp',
  instagram: 'com.instagram.android',
  telegram:  'org.telegram.messenger',
  spotify:   'com.spotify.music',
  youtube:   'com.google.android.youtube',
  maps:      'com.google.android.apps.maps',
  gmail:     'com.google.android.gm',
  camera:    'com.android.camera',
  gallery:   'com.google.android.apps.photos',
  settings:  'com.android.settings',
  browser:   'com.android.chrome',
  calculator:'com.google.android.calculator',
  calendar:  'com.google.android.calendar',
  clock:     'com.google.android.deskclock',
};

// ── Debug Logger ───────────────────────────────────────────────────────────
function dbg(label, data) {
  if (process.env.DEBUG_ROUTING !== 'true') return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[Planner:${ts}] ${label}`, typeof data === 'object' ? JSON.stringify(data) : (data || ''));
}

// ── Compound Request Splitter ──────────────────────────────────────────────
/**
 * Splits compound requests like "open WhatsApp and message Mom"
 * into individual action phrases.
 */
function splitCompoundRequest(message) {
  const lower = message.toLowerCase();

  // Pattern: "X and Y" or "X, then Y" or "X and also Y"
  const conjunctions = /\b(?:and then|and also|then|also|,\s*and|,\s*then|and)\b/gi;

  // Don't split if "and" is part of a natural phrase
  const naturalAnds = [
    'bread and butter', 'salt and pepper', 'pros and cons',
    'black and white', 'day and night', 'left and right',
    'rise and fall', 'come and go', 'back and forth',
  ];
  if (naturalAnds.some(p => lower.includes(p))) return [message];

  // Check if there's actually a conjunction splitting two actions
  const parts = message.split(conjunctions).map(p => p.trim()).filter(p => p.length > 0);

  if (parts.length <= 1) return [message];

  // Validate each part looks like an actionable phrase (has a verb)
  const actionVerbs = /\b(open|send|message|call|play|search|find|navigate|show|read|check|turn|set|close|launch|go|take|tell|ask|create|add|delete|remove|cancel|schedule|book)\b/i;
  const actionable = parts.filter(p => actionVerbs.test(p));

  // If splitting produced non-actionable fragments, return original
  if (actionable.length < parts.length * 0.5) return [message];

  return parts;
}

// ── Detect collection mode ─────────────────────────────────────────────────
function detectCollectionMode(intent, entities) {
  const collectionSpec = COLLECTION_INTENTS[intent];
  if (!collectionSpec) return null;

  for (const field of collectionSpec.requiredFields) {
    if (!entities[field] || !entities[field].trim()) {
      return {
        field:     collectionSpec.promptField,
        prompt:    collectionSpec.prompt,
        recipient: entities.recipient || null,
        intent,
      };
    }
  }
  return null;
}

// ── Build single step ──────────────────────────────────────────────────────
function buildStep(index, toolName, intent, entities, message) {
  const executedOn = DEVICE_INTENTS.has(intent || toolName) ? 'device' : 'server';
  const action     = TOOL_ACTIONS[intent || toolName] || 'execute';

  const step = {
    stepIndex:  index,
    tool:       toolName || intent || 'ai',
    action,
    params:     {},
    executedOn,
    status:     'pending',
    verified:   false,
  };

  // Populate params from entities
  if (entities.city)      step.params.city      = entities.city;
  if (entities.topic)     step.params.topic     = entities.topic;
  if (entities.recipient) step.params.recipient = entities.recipient;
  if (entities.app)       step.params.app       = entities.app;
  if (entities.query)     step.params.query     = entities.query;
  if (entities.message)   step.params.message   = entities.message;

  // Resolve app package for open_app
  if (intent === 'open_app' && entities.app) {
    const appLower = entities.app.toLowerCase();
    if (APP_PACKAGES[appLower]) {
      step.params.package = APP_PACKAGES[appLower];
    }
  }

  // Clean empty params
  if (Object.keys(step.params).length === 0) {
    step.params = { rawMessage: message };
  }

  return step;
}

// ── Main Planner Entry ─────────────────────────────────────────────────────

/**
 * Plan the execution of a user request.
 *
 * @param {string} message    - User's original message
 * @param {string|null} intent - Detected intent (from ToolRouterService.detectIntent)
 * @param {string|null} toolName - Detected tool name
 * @param {object} entities   - Extracted entities { city, topic, recipient, app, query }
 * @returns {{ steps: Array, requiresCollection: boolean, collectionMode: object|null }}
 */
function plan(message, intent, toolName, entities = {}) {
  const t0 = Date.now();

  dbg('Input', { message: message.slice(0, 80), intent, toolName, entities });

  // ── Check for collection mode first ──────────────────────────────────────
  const collection = detectCollectionMode(intent || toolName, entities);
  if (collection) {
    dbg('CollectionMode', collection);
    return {
      steps: [],
      requiresCollection: true,
      collectionMode: collection,
    };
  }

  // ── Try compound splitting ───────────────────────────────────────────────
  const parts = splitCompoundRequest(message);

  if (parts.length > 1) {
    dbg('CompoundSplit', { parts: parts.length, segments: parts });

    // For compound requests, each part is planned independently
    // The first part uses the detected intent; subsequent parts get
    // their intent inferred from the action verbs
    const steps = [];
    let idx = 1;

    for (const part of parts) {
      const partIntent = inferIntentFromPhrase(part);
      const partEntities = extractEntitiesFromPhrase(part, entities);
      const partTool = partIntent ? (TOOL_ACTIONS[partIntent] ? partIntent : null) : null;

      steps.push(buildStep(idx++, partTool || partIntent, partIntent, partEntities, part));
    }

    dbg('Plan', { steps: steps.length, elapsedMs: Date.now() - t0 });
    return { steps, requiresCollection: false, collectionMode: null };
  }

  // ── Single-step plan ─────────────────────────────────────────────────────
  if (!toolName && !intent) {
    // Pure AI / knowledge query — no tool steps
    dbg('NoTool', 'Pure AI query, empty plan');
    return { steps: [], requiresCollection: false, collectionMode: null };
  }

  const step = buildStep(1, toolName, intent, entities, message);
  dbg('Plan', { steps: 1, elapsedMs: Date.now() - t0 });

  return { steps: [step], requiresCollection: false, collectionMode: null };
}

// ── Helper: Infer intent from a sub-phrase ─────────────────────────────────
function inferIntentFromPhrase(phrase) {
  const lower = phrase.toLowerCase();

  if (/\b(open|launch|go to)\b/i.test(lower)) {
    // Extract app name
    const appMatch = lower.match(/(?:open|launch|go to)\s+(.+)/i);
    if (appMatch) {
      const appName = appMatch[1].trim();
      if (APP_PACKAGES[appName]) return 'open_app';
    }
    return 'open_app';
  }
  if (/\b(message|text|send|whatsapp)\b/i.test(lower)) return 'send_message';
  if (/\b(call|dial|ring)\b/i.test(lower))             return 'call_contact';
  if (/\b(navigate|directions?|take me)\b/i.test(lower)) return 'maps';
  if (/\b(weather|temperature|rain|forecast)\b/i.test(lower)) return 'weather';
  if (/\b(email|inbox|gmail)\b/i.test(lower))           return 'gmail';
  if (/\b(calendar|schedule|meeting|event)\b/i.test(lower)) return 'calendar';
  if (/\b(play|music|song|playlist)\b/i.test(lower))    return 'music';
  if (/\b(flashlight|torch|volume|brightness|bluetooth|wifi|battery|sms|messages)\b/i.test(lower)) return 'device_control';
  if (/\b(news|headlines)\b/i.test(lower))              return 'news';
  if (/\b(search|find|video|youtube)\b/i.test(lower))   return 'youtube';

  return 'general_chat';
}

// ── Helper: Extract entities from a sub-phrase ─────────────────────────────
function extractEntitiesFromPhrase(phrase, parentEntities) {
  const result = {};

  // Inherit parent entities as defaults
  if (parentEntities.city) result.city = parentEntities.city;

  // Extract recipient: "message Mom", "call Dad"
  const recipientMatch = phrase.match(/(?:message|text|call|send\s+(?:message|text)\s+to)\s+(\w+)/i);
  if (recipientMatch) result.recipient = recipientMatch[1];

  // Extract app name: "open WhatsApp"
  const appMatch = phrase.match(/(?:open|launch)\s+(\w+)/i);
  if (appMatch) result.app = appMatch[1];

  return result;
}

module.exports = { plan };
