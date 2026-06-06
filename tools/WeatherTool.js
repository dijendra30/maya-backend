/**
 * Weather Tool — Maya Phase 4
 *
 * Uses OpenWeatherMap API (current + 5-day/3-hour forecast).
 * Returns a voice-ready reply directly — no LLM needed for data queries.
 *
 * Env vars required:
 *   OPENWEATHER_API_KEY  — https://openweathermap.org/api
 *   DEFAULT_CITY         — fallback city when none extracted (default: Raipur)
 */

const axios = require('axios');

const OWM_CURRENT  = 'https://api.openweathermap.org/data/2.5/weather';
const OWM_FORECAST = 'https://api.openweathermap.org/data/2.5/forecast';

// ── City Extraction ─────────────────────────────────────────────────────────

/**
 * Try to pull a city name from the message.
 * Falls back to the location field, then to DEFAULT_CITY env.
 */
function extractCity(message, location) {
  const stopWords = ['today', 'tomorrow', 'tonight', 'the', 'my', 'now', 'outside', 'like'];

  // Pattern 1: "weather in Port Blair", "forecast for New Delhi", "temperature at Pune"
  const inMatch = message.match(/\b(?:in|at|for|of)\s+([A-Za-z][A-Za-z\s]{1,30}?)(?:\s*[\?\.]|\s+(?:today|tomorrow|tonight|this week|right now|now|please|$))/i);
  if (inMatch) {
    const candidate = inMatch[1].trim();
    if (!stopWords.includes(candidate.toLowerCase())) return candidate;
  }

  // Pattern 2: "Port Blair weather", "New Delhi temperature"
  const prefixMatch = message.match(/^([A-Za-z][A-Za-z\s]{1,25}?)\s+(?:weather|temperature|forecast|mausam)/i);
  if (prefixMatch) {
    const candidate = prefixMatch[1].trim();
    if (!stopWords.includes(candidate.toLowerCase())) return candidate;
  }

  // Pattern 3: Hindi — "Delhi ka mausam", "Mumbai mein barish"
  const hindiMatch = message.match(/([A-Za-z][A-Za-z\s]{1,25}?)\s+(?:ka mausam|ki garmi|ki thand|mein barish)/i);
  if (hindiMatch) {
    const candidate = hindiMatch[1].trim();
    if (!stopWords.includes(candidate.toLowerCase())) return candidate;
  }

  if (location && location.length > 1) return location;
  return process.env.DEFAULT_CITY || 'Raipur';
}

// ── Formatting Helpers ──────────────────────────────────────────────────────

function formatWind(speedMs) {
  const kmh = Math.round(speedMs * 3.6);
  if (kmh < 10) return 'light breeze';
  if (kmh < 30) return `${kmh} km/h winds`;
  if (kmh < 60) return `strong ${kmh} km/h winds`;
  return `very strong ${kmh} km/h winds, be careful outside`;
}

function formatTime(unixTs, offsetSec) {
  const d = new Date((unixTs + offsetSec) * 1000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

// ── Current Weather ─────────────────────────────────────────────────────────

async function fetchCurrent(message, location) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return {
      reply: "Weather API key is not set up. Please add OPENWEATHER_API_KEY to the backend environment.",
      toolUsed: 'weather',
    };
  }

  const city = extractCity(message, location);
  const lower = message.toLowerCase();

  try {
    const { data } = await axios.get(OWM_CURRENT, {
      params: { q: city, appid: apiKey, units: 'metric' },
      timeout: 8000,
    });

    const temp    = Math.round(data.main.temp);
    const feels   = Math.round(data.main.feels_like);
    const hum     = data.main.humidity;
    const desc    = data.weather[0].description;
    const wind    = formatWind(data.wind.speed);
    const name    = data.name;
    const isRain  = /rain|drizzle|shower|thunder/i.test(desc);
    const offset  = data.timezone;

    // Intent-specific replies
    if (/rain|umbrella|shower|wet/i.test(lower)) {
      return {
        reply: isRain
          ? `Yes, it is ${desc} in ${name} right now with ${hum}% humidity. You should carry an umbrella.`
          : `No rain right now in ${name}. It is ${desc} with ${temp}°C. ${hum < 70 ? 'Clear to go out.' : 'Humidity is quite high though.'}`,
        toolUsed: 'weather',
      };
    }

    if (/hot|heat|warm|sunny/i.test(lower)) {
      const comment = temp > 38 ? 'Extremely hot outside, please stay hydrated.'
        : temp > 32 ? 'Very warm, carry water.'
        : temp > 26 ? 'Quite warm outside.'
        : 'Not too hot actually.';
      return {
        reply: `It is ${temp}°C in ${name} right now, feeling like ${feels}°C. ${desc}. ${comment}`,
        toolUsed: 'weather',
      };
    }

    if (/cold|cool|chill/i.test(lower)) {
      const comment = temp < 10 ? 'Very cold, wear a heavy jacket.'
        : temp < 18 ? 'Quite cold, wear a jacket.'
        : temp < 22 ? 'Mildly cool outside.'
        : "It's actually not very cold.";
      return {
        reply: `It is ${temp}°C in ${name} right now, ${desc}. ${comment}`,
        toolUsed: 'weather',
      };
    }

    if (/sunrise/i.test(lower)) {
      const sr = formatTime(data.sys.sunrise, offset);
      return { reply: `Sunrise in ${name} is at ${sr} today.`, toolUsed: 'weather' };
    }

    if (/sunset/i.test(lower)) {
      const ss = formatTime(data.sys.sunset, offset);
      return { reply: `Sunset in ${name} is at ${ss} today.`, toolUsed: 'weather' };
    }

    // General weather
    return {
      reply: `In ${name}, it is ${temp}°C right now, ${desc}. Feels like ${feels}°C, humidity ${hum}%, with ${wind}.`,
      toolUsed: 'weather',
    };

  } catch (err) {
    if (err.response?.status === 404) {
      return { reply: `I could not find weather data for ${city}. Try saying the city name more clearly.`, toolUsed: 'weather' };
    }
    if (err.response?.status === 401) {
      return { reply: 'Weather API key is invalid. Please check OPENWEATHER_API_KEY.', toolUsed: 'weather' };
    }
    throw err;
  }
}

// ── Forecast ────────────────────────────────────────────────────────────────

async function fetchForecast(message, location) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return {
      reply: "Weather API key is not set up. Please add OPENWEATHER_API_KEY to the backend environment.",
      toolUsed: 'weather',
    };
  }

  const city  = extractCity(message, location);
  const lower = message.toLowerCase();

  try {
    const { data } = await axios.get(OWM_FORECAST, {
      params: { q: city, appid: apiKey, units: 'metric', cnt: 16 }, // ~2 days
      timeout: 8000,
    });

    const cityName = data.city.name;
    const list     = data.list;

    // Determine target day
    const now       = new Date();
    let targetDate;

    if (/tonight/i.test(lower)) {
      targetDate = now.toISOString().split('T')[0];
    } else if (/tomorrow/i.test(lower)) {
      const d = new Date(now); d.setDate(d.getDate() + 1);
      targetDate = d.toISOString().split('T')[0];
    } else {
      targetDate = now.toISOString().split('T')[0];
    }

    const daySlots = list.filter(f => f.dt_txt.startsWith(targetDate));
    const slots    = daySlots.length > 0 ? daySlots : list.slice(0, 4);

    const maxT   = Math.round(Math.max(...slots.map(f => f.main.temp_max)));
    const minT   = Math.round(Math.min(...slots.map(f => f.main.temp_min)));
    const descs  = [...new Set(slots.map(f => f.weather[0].description))];
    const hasRain = descs.some(d => /rain|drizzle|shower|thunder/i.test(d));

    const when = /tonight/i.test(lower) ? 'tonight' : /tomorrow/i.test(lower) ? 'tomorrow' : 'today';

    if (/rain|umbrella/i.test(lower)) {
      return {
        reply: hasRain
          ? `Yes, rain is expected in ${cityName} ${when}. Carry an umbrella. Temperatures will be between ${minT}°C and ${maxT}°C.`
          : `No rain expected in ${cityName} ${when}. ${descs[0]}, with temperatures from ${minT}°C to ${maxT}°C.`,
        toolUsed: 'weather',
      };
    }

    return {
      reply: `${cityName} ${when}: ${descs[0]}, temperatures from ${minT}°C to ${maxT}°C.${hasRain ? ' Some rain expected.' : ''}`,
      toolUsed: 'weather',
    };

  } catch (err) {
    if (err.response?.status === 404) {
      return { reply: `I could not find forecast data for ${city}.`, toolUsed: 'weather' };
    }
    throw err;
  }
}

// ── Entry Point ─────────────────────────────────────────────────────────────

async function fetch(message, location) {
  if (/tomorrow|tonight|this week|weekly|forecast|next \d+ days/i.test(message)) {
    return fetchForecast(message, location);
  }
  return fetchCurrent(message, location);
}

module.exports = { fetch };
