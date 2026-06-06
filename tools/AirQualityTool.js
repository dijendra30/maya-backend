/**
 * Air Quality Tool — Maya Phase 4
 *
 * Uses Google Air Quality API to get current AQI for a city.
 * Falls back to a graceful message when key is absent.
 *
 * Env vars required:
 *   GOOGLE_AIR_QUALITY_API_KEY  — https://developers.google.com/maps/documentation/air-quality
 */

const axios = require('axios');

const AIR_API_URL = 'https://airquality.googleapis.com/v1/currentConditions:lookup';

// ── AQI Description ─────────────────────────────────────────────────────────

const AQI_LEVELS = [
  { max:  50, label: 'Good',                    tip: 'Air is clean. A great day to be outside.' },
  { max: 100, label: 'Moderate',                tip: 'Air quality is acceptable. Sensitive people should take care.' },
  { max: 150, label: 'Unhealthy for sensitive', tip: 'People with asthma or heart conditions should limit outdoor activity.' },
  { max: 200, label: 'Unhealthy',               tip: 'Everyone may experience health effects. Limit prolonged outdoor exertion.' },
  { max: 300, label: 'Very Unhealthy',          tip: 'Health alert: serious health effects for everyone. Avoid outdoor activity.' },
  { max: 999, label: 'Hazardous',               tip: 'Emergency conditions. Stay indoors and keep windows closed.' },
];

function describeAqi(aqi) {
  const level = AQI_LEVELS.find(l => aqi <= l.max) || AQI_LEVELS[AQI_LEVELS.length - 1];
  return level;
}

// ── City → Coordinates ──────────────────────────────────────────────────────

const CITY_COORDS = {
  raipur:      { lat: 21.2514, lng: 81.6296 },
  delhi:       { lat: 28.6139, lng: 77.2090 },
  'new delhi': { lat: 28.6139, lng: 77.2090 },
  mumbai:      { lat: 19.0760, lng: 72.8777 },
  bangalore:   { lat: 12.9716, lng: 77.5946 },
  bengaluru:   { lat: 12.9716, lng: 77.5946 },
  hyderabad:   { lat: 17.3850, lng: 78.4867 },
  chennai:     { lat: 13.0827, lng: 80.2707 },
  kolkata:     { lat: 22.5726, lng: 88.3639 },
  pune:        { lat: 18.5204, lng: 73.8567 },
  ahmedabad:   { lat: 23.0225, lng: 72.5714 },
  jaipur:      { lat: 26.9124, lng: 75.7873 },
  lucknow:     { lat: 26.8467, lng: 80.9462 },
  bhopal:      { lat: 23.2599, lng: 77.4126 },
  nagpur:      { lat: 21.1458, lng: 79.0882 },
  patna:       { lat: 25.5941, lng: 85.1376 },
};

function getCityCoords(location) {
  const key = (location || '').toLowerCase().trim();
  return CITY_COORDS[key] || CITY_COORDS['raipur'];
}

// ── Main Fetch ──────────────────────────────────────────────────────────────

async function fetch(location) {
  const apiKey = process.env.GOOGLE_AIR_QUALITY_API_KEY;
  if (!apiKey) {
    return {
      reply: "Air quality API key is not configured. Please add GOOGLE_AIR_QUALITY_API_KEY to the backend environment.",
      toolUsed: 'air_quality',
    };
  }

  const coords   = getCityCoords(location);
  const cityName = location || process.env.DEFAULT_CITY || 'Raipur';

  try {
    const { data } = await axios.post(
      `${AIR_API_URL}?key=${apiKey}`,
      {
        location: { latitude: coords.lat, longitude: coords.lng },
        extraComputations: ['HEALTH_RECOMMENDATIONS'],
        languageCode: 'en',
      },
      { timeout: 8000 }
    );

    const indexes = data.indexes || [];
    const index   = indexes.find(i => i.code === 'uaqi') || indexes[0];

    if (!index) {
      return { reply: `Could not get air quality data for ${cityName} right now.`, toolUsed: 'air_quality' };
    }

    const aqi   = index.aqi;
    const level = describeAqi(aqi);

    return {
      reply:    `Air quality in ${cityName} is ${level.label}, AQI ${aqi}. ${level.tip}`,
      toolUsed: 'air_quality',
      aqi,
    };

  } catch (err) {
    if (err.response?.status === 400 || err.response?.status === 403) {
      return { reply: 'Air quality data is temporarily unavailable. Please try again later.', toolUsed: 'air_quality' };
    }
    throw err;
  }
}

module.exports = { fetch };
