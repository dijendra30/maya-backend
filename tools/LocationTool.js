/**
 * Location Tool — Maya Phase 4
 *
 * Features:
 *   - "Where am I?" → reverse geocode lat/lng → city name
 *   - "Find hospital nearby" → Google Places Nearby Search
 *   - "Find ATM near me" → Places Nearby Search
 *
 * Env vars:
 *   GOOGLE_MAPS_API_KEY  — https://console.cloud.google.com
 *     (Enable: Geocoding API, Places API)
 */

const axios = require('axios');

const GEOCODE_URL      = 'https://maps.googleapis.com/maps/api/geocode/json';
const PLACES_NEARBY_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

const PLACE_TYPES = {
  hospital:   'hospital',
  doctor:     'doctor',
  pharmacy:   'pharmacy',
  atm:        'atm',
  bank:       'bank',
  restaurant: 'restaurant',
  food:       'restaurant',
  cafe:       'cafe',
  coffee:     'cafe',
  petrol:     'gas_station',
  fuel:       'gas_station',
  'gas station': 'gas_station',
  hotel:      'lodging',
  school:     'school',
  college:    'university',
  park:       'park',
  gym:        'gym',
  supermarket:'supermarket',
  grocery:    'grocery_or_supermarket',
  police:     'police',
  airport:    'airport',
};

function extractPlaceType(lower) {
  for (const [keyword, type] of Object.entries(PLACE_TYPES)) {
    if (lower.includes(keyword)) return type;
  }
  return null;
}

// ── Reverse Geocode ─────────────────────────────────────────────────────────

async function reverseGeocode(lat, lng) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { reply: 'Location tool is not configured. Please add GOOGLE_MAPS_API_KEY.', toolUsed: 'location' };
  }
  try {
    const { data } = await axios.get(GEOCODE_URL, {
      params: { latlng: `${lat},${lng}`, key: apiKey, result_type: 'locality|sublocality' },
      timeout: 8000,
    });
    if (data.status !== 'OK' || !data.results.length) {
      return { reply: `You are at coordinates ${lat.toFixed(4)}, ${lng.toFixed(4)}.`, toolUsed: 'location' };
    }
    const address = data.results[0].formatted_address;
    const locality = data.results[0].address_components
      .find(c => c.types.includes('locality'))?.long_name
      || data.results[0].address_components
      .find(c => c.types.includes('sublocality_level_1'))?.long_name
      || address;
    return { reply: `You are currently in ${locality}. Full address: ${address}.`, toolUsed: 'location' };
  } catch (err) {
    return { reply: 'Could not determine your location right now.', toolUsed: 'location' };
  }
}

// ── Places Nearby ───────────────────────────────────────────────────────────

async function placesNearby(lat, lng, placeType, message) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { reply: 'Location tool is not configured. Please add GOOGLE_MAPS_API_KEY.', toolUsed: 'location' };
  }
  try {
    const { data } = await axios.get(PLACES_NEARBY_URL, {
      params: { location: `${lat},${lng}`, radius: 3000, type: placeType, key: apiKey },
      timeout: 8000,
    });
    if (data.status !== 'OK' || !data.results.length) {
      return { reply: `I could not find any ${placeType.replace('_', ' ')} nearby.`, toolUsed: 'location' };
    }
    const places  = data.results.slice(0, 3);
    const nearest = places[0];
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(placeType)}/@${lat},${lng},15z`;
    const names   = places.map((p, i) => `${i + 1}. ${p.name}${p.vicinity ? ` — ${p.vicinity}` : ''}`).join('. ');
    return {
      reply:       `Nearest ${placeType.replace('_', ' ')}: ${nearest.name}. ${names}`,
      toolUsed:    'location',
      phoneAction: { type: 'OPEN_URL', url: mapsUrl },
    };
  } catch (err) {
    return { reply: `Could not find nearby ${placeType.replace('_', ' ')} right now.`, toolUsed: 'location' };
  }
}

// ── Main Entry ──────────────────────────────────────────────────────────────

async function fetch(message, location, options = {}) {
  const lower     = message.toLowerCase();
  const { latitude, longitude } = options;
  const hasCoords = latitude != null && longitude != null;

  const placeType = extractPlaceType(lower);
  const isWhereAmI = /where am i|what city|my location|current location|my address|where i am/i.test(lower);

  // If asking for nearby places
  if (placeType && hasCoords) {
    return placesNearby(latitude, longitude, placeType, message);
  }

  // If asking where they are
  if (isWhereAmI && hasCoords) {
    return reverseGeocode(latitude, longitude);
  }

  // No GPS coords provided
  if (placeType) {
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(placeType.replace('_', ' '))}+near+me`;
    return {
      reply:       `Opening Google Maps to find ${placeType.replace('_', ' ')} near you.`,
      toolUsed:    'location',
      phoneAction: { type: 'OPEN_URL', url: mapsUrl },
    };
  }

  if (isWhereAmI) {
    return { reply: 'I need your GPS location to answer that. Please enable location permission for Maya.', toolUsed: 'location' };
  }

  return { reply: 'I could not understand your location request.', toolUsed: 'location' };
}

module.exports = { fetch };
