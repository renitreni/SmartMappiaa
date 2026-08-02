const express = require('express');
const router = express.Router();
const {
  locationSearchLimiter,
  locationReverseLimiter,
  locationNearbyLimiter,
} = require('../middleware/rateLimiters');

// ---------------------------------------------------------------------
// Location endpoints backed by Google Maps Platform (replaces the old
// Nominatim/Overpass proxies):
//   GET  /search?q=&lat=&lng=&token=   -> Places Autocomplete (New)  (predictions, NO coords)
//   GET  /details?id=&token=           -> Place Details (New)        (coords for a prediction)
//   GET  /reverse?lat=&lng=            -> Geocoding API (reverse)     (coords -> address)
//   GET  /nearby?lat=&lng=&radius=     -> Places Nearby Search (New) (POIs around a pin)
//
// The GOOGLE_MAPS_SERVER_KEY stays server-side; the browser calls these
// same-origin under /api. Autocomplete + Details share a client-supplied
// `token` (session token) so the keystrokes bill as one cheap session.
// ---------------------------------------------------------------------
const RIYADH = { lat: 24.7136, lng: 46.6753 };
const PLACES_BASE = 'https://places.googleapis.com/v1';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// Overpass amenity/shop/tourism tags -> Places (New) types for /nearby.
const NEARBY_TYPES = [
  'restaurant', 'cafe', 'meal_takeaway', 'gas_station', 'pharmacy',
  'hospital', 'doctor', 'bank', 'atm', 'parking', 'supermarket',
  'convenience_store', 'shopping_mall', 'lodging', 'tourist_attraction',
];

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function apiKey() {
  return process.env.GOOGLE_MAPS_SERVER_KEY || '';
}

// --- Tiny in-memory TTL cache ------------------------------------------------
// The location picker is chatty (reverse/nearby fire on map moves, search on
// typing). Caching identical lookups for a minute cuts BOTH our own rate-limit
// pressure and the number of billable Google calls.
const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map(); // key -> { at, value }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit); // refresh LRU order
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// Round a coord for cache keys (~11m at 4dp, ~110m at 3dp).
const round = (n, dp) => Number(n).toFixed(dp);

// --- Google request helpers --------------------------------------------------
async function placesPost(path, body, fieldMask) {
  const res = await fetch(`${PLACES_BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Places API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function placeDetails(placeId, sessionToken) {
  const params = new URLSearchParams({ languageCode: 'en' });
  if (sessionToken) params.set('sessionToken', sessionToken);
  const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}?${params}`, {
    headers: {
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': 'id,location,displayName,formattedAddress,types',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Place Details ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function placeView(place) {
  return {
    id: place.id || '',
    name: place.displayName?.text || place.formattedAddress?.split(',')[0] || 'Selected location',
    address: place.formattedAddress || '',
    lat: num(place.location?.latitude),
    lng: num(place.location?.longitude),
    type: (place.types && place.types[0]) || 'place',
  };
}

// --- /search : Places Autocomplete (New) — predictions only (no coords) ------
router.get('/search', locationSearchLimiter, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    if (!apiKey()) return res.status(502).json({ error: 'Location search is not configured' });

    const lat = num(req.query.lat, RIYADH.lat);
    const lng = num(req.query.lng, RIYADH.lng);
    const token = String(req.query.token || '');

    // Session-token predictions are billed as part of the session, so they must
    // not be cached across sessions; cache only the coordinate-biased query text.
    const cacheKey = `s:${q.toLowerCase()}:${round(lat, 2)}:${round(lng, 2)}`;
    if (!token) {
      const cached = cacheGet(cacheKey);
      if (cached) return res.json({ results: cached });
    }

    const body = {
      input: q,
      languageCode: 'en',
      includedRegionCodes: ['sa'],
      locationBias: {
        circle: { center: { latitude: lat, longitude: lng }, radius: 50000.0 },
      },
    };
    if (token) body.sessionToken = token;

    const data = await placesPost('places:autocomplete', body);
    const results = (data.suggestions || [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        id: p.placeId,
        name: p.structuredFormat?.mainText?.text || p.text?.text || 'Location',
        address: p.structuredFormat?.secondaryText?.text || '',
        lat: null, // coords come from /details on selection
        lng: null,
        type: 'place',
      }))
      .filter((r) => r.id);

    if (!token) cacheSet(cacheKey, results);
    return res.json({ results });
  } catch (err) {
    console.error('location search error:', err.message || err);
    return res.status(502).json({ error: 'Location search is temporarily unavailable' });
  }
});

// --- /details : Place Details (New) — resolve coords for a prediction --------
router.get('/details', locationSearchLimiter, async (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    if (!apiKey()) return res.status(502).json({ error: 'Location lookup is not configured' });

    const token = String(req.query.token || '');
    const cacheKey = `d:${id}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ place: cached });

    const data = await placeDetails(id, token);
    const place = placeView(data);
    cacheSet(cacheKey, place);
    return res.json({ place });
  } catch (err) {
    console.error('location details error:', err.message || err);
    return res.status(502).json({ error: 'Could not read this location' });
  }
});

// --- /reverse : Geocoding API (reverse) — coords -> address ------------------
router.get('/reverse', locationReverseLimiter, async (req, res) => {
  try {
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });
    if (!apiKey()) return res.status(502).json({ error: 'Location lookup is not configured' });

    const cacheKey = `r:${round(lat, 4)}:${round(lng, 4)}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ place: cached });

    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: apiKey(),
      language: 'en',
      region: 'sa',
    });
    const gres = await fetch(`${GEOCODE_URL}?${params}`);
    if (!gres.ok) throw new Error(`Geocoding ${gres.status}`);
    const data = await gres.json();
    const top = (data.results || [])[0];
    if (!top) return res.status(404).json({ error: 'No address found for this location' });

    const place = {
      id: String(top.place_id || `${lat},${lng}`),
      name: top.formatted_address?.split(',')[0] || 'Selected location',
      address: top.formatted_address || '',
      lat: num(top.geometry?.location?.lat, lat),
      lng: num(top.geometry?.location?.lng, lng),
      type: (top.types && top.types[0]) || 'place',
    };
    cacheSet(cacheKey, place);
    return res.json({ place });
  } catch (err) {
    console.error('location reverse error:', err.message || err);
    return res.status(502).json({ error: 'Could not read this location address' });
  }
});

// --- /nearby : Places Nearby Search (New) — POIs around a pin ----------------
router.get('/nearby', locationNearbyLimiter, async (req, res) => {
  try {
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });
    if (!apiKey()) return res.status(502).json({ error: 'Nearby places are not configured' });

    const radius = clamp(num(req.query.radius, 1200), 100, 3000);

    const cacheKey = `n:${round(lat, 3)}:${round(lng, 3)}:${radius}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ places: cached });

    const body = {
      includedTypes: NEARBY_TYPES,
      maxResultCount: 20,
      languageCode: 'en',
      regionCode: 'SA',
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius },
      },
    };
    // Minimal field mask keeps Nearby Search on the cheaper billing tier.
    const data = await placesPost(
      'places:searchNearby',
      body,
      'places.id,places.displayName,places.location,places.formattedAddress,places.types'
    );

    const places = (data.places || [])
      .map(placeView)
      .filter((p) => p.lat != null && p.lng != null);

    cacheSet(cacheKey, places);
    return res.json({ places });
  } catch (err) {
    console.error('nearby places error:', err.message || err);
    return res.status(502).json({ error: 'Nearby places are temporarily unavailable' });
  }
});

module.exports = router;
