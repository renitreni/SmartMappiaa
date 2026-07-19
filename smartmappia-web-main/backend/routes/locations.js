const express = require('express');
const router = express.Router();
const {
  locationSearchLimiter,
  locationReverseLimiter,
  locationNearbyLimiter,
} = require('../middleware/rateLimiters');

const RIYADH = { lat: 24.7136, lng: 46.6753 };
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
// Nominatim's usage policy requires a genuine identifying User-Agent with a
// contact. Default carries the site URL; set LOCATION_API_USER_AGENT in prod to
// add a contact email, e.g. "SmartMappia/1.0 (contact: ops@smartmappia.com)".
const USER_AGENT = process.env.LOCATION_API_USER_AGENT || 'SmartMappia/1.0 (+https://smartmappia.com)';

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// --- Tiny in-memory TTL cache ------------------------------------------------
// The location picker is chatty (reverse/nearby fire on map moves, search on
// typing). Caching identical lookups for a minute cuts BOTH our own rate-limit
// pressure and calls to the external OSM services (which ban aggressive use).
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
  // Refresh LRU order.
  cache.delete(key);
  cache.set(key, hit);
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

function compactAddress(address = {}) {
  return [
    address.road,
    address.neighbourhood || address.suburb || address.city_district,
    address.city || address.town || address.village || 'Riyadh',
  ].filter(Boolean).join(', ');
}

function view(place) {
  const lat = num(place.lat);
  const lng = num(place.lon ?? place.lng);
  return {
    id: String(place.place_id || place.osm_id || `${lat},${lng}`),
    name: place.name || place.display_name?.split(',')[0] || 'Selected location',
    address: compactAddress(place.address) || place.display_name || '',
    lat,
    lng,
    type: place.type || place.class || 'place',
  };
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    // Accept-Language: en makes Nominatim return English/romanized names
    // (e.g. "Al Olaya", "As Sulimaniyah") instead of Arabic for Riyadh — so
    // pickup/delivery addresses are consistent Latin text and never garble in
    // the PDF invoice. Overpass (/nearby) reads name tags directly, unaffected.
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Accept-Language': 'en',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Location provider failed (${res.status})`);
  return res.json();
}

router.get('/search', locationSearchLimiter, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });

    const lat = num(req.query.lat, RIYADH.lat);
    const lng = num(req.query.lng, RIYADH.lng);

    const cacheKey = `s:${q.toLowerCase()}:${round(lat, 2)}:${round(lng, 2)}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ results: cached });

    const params = new URLSearchParams({
      q,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '8',
      countrycodes: 'sa',
      bounded: '0',
      viewbox: `${lng - 0.35},${lat + 0.25},${lng + 0.35},${lat - 0.25}`,
    });

    const data = await fetchJson(`${NOMINATIM}/search?${params}`);
    const results = (data || []).map(view).filter((p) => p.lat != null && p.lng != null);
    cacheSet(cacheKey, results);
    return res.json({ results });
  } catch (err) {
    console.error('location search error:', err.message || err);
    return res.status(502).json({ error: 'Location search is temporarily unavailable' });
  }
});

router.get('/reverse', locationReverseLimiter, async (req, res) => {
  try {
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });

    const cacheKey = `r:${round(lat, 4)}:${round(lng, 4)}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ place: cached });

    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: 'jsonv2',
      addressdetails: '1',
    });
    const data = await fetchJson(`${NOMINATIM}/reverse?${params}`);
    const place = view(data);
    cacheSet(cacheKey, place);
    return res.json({ place });
  } catch (err) {
    console.error('location reverse error:', err.message || err);
    return res.status(502).json({ error: 'Could not read this location address' });
  }
});

router.get('/nearby', locationNearbyLimiter, async (req, res) => {
  try {
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });

    const radius = clamp(num(req.query.radius, 1200), 100, 3000);

    const cacheKey = `n:${round(lat, 3)}:${round(lng, 3)}:${radius}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ places: cached });

    const query = `
      [out:json][timeout:8];
      (
        node["amenity"~"restaurant|cafe|fast_food|fuel|pharmacy|hospital|bank|atm|parking|clinic"](around:${radius},${lat},${lng});
        node["shop"~"supermarket|convenience|mall"](around:${radius},${lat},${lng});
        node["tourism"~"hotel|attraction"](around:${radius},${lat},${lng});
      );
      out center 24;
    `;

    const data = await fetchJson(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
    });

    const places = (data.elements || [])
      .map((el) => ({
        id: String(el.id),
        name: el.tags?.name || el.tags?.brand || el.tags?.amenity || el.tags?.shop || 'Nearby place',
        address: [el.tags?.['addr:street'], el.tags?.['addr:city']].filter(Boolean).join(', '),
        lat: num(el.lat ?? el.center?.lat),
        lng: num(el.lon ?? el.center?.lon),
        type: el.tags?.amenity || el.tags?.shop || el.tags?.tourism || 'place',
      }))
      .filter((p) => p.lat != null && p.lng != null);

    cacheSet(cacheKey, places);
    return res.json({ places });
  } catch (err) {
    console.error('nearby places error:', err.message || err);
    return res.status(502).json({ error: 'Nearby places are temporarily unavailable' });
  }
});

module.exports = router;
