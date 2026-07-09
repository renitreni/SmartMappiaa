const express = require('express');
const router = express.Router();
const { locationSearchLimiter } = require('../middleware/rateLimiters');

const RIYADH = { lat: 24.7136, lng: 46.6753 };
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = process.env.LOCATION_API_USER_AGENT || 'SmartMappia/1.0';

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

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
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(opts.headers || {}) },
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
    return res.json({ results: (data || []).map(view).filter((p) => p.lat != null && p.lng != null) });
  } catch (err) {
    console.error('location search error:', err.message || err);
    return res.status(502).json({ error: 'Location search is temporarily unavailable' });
  }
});

router.get('/reverse', locationSearchLimiter, async (req, res) => {
  try {
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });

    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: 'jsonv2',
      addressdetails: '1',
    });
    const data = await fetchJson(`${NOMINATIM}/reverse?${params}`);
    return res.json({ place: view(data) });
  } catch (err) {
    console.error('location reverse error:', err.message || err);
    return res.status(502).json({ error: 'Could not read this location address' });
  }
});

router.get('/nearby', locationSearchLimiter, async (req, res) => {
  try {
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng are required' });

    const radius = clamp(num(req.query.radius, 1200), 100, 3000);
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

    return res.json({ places });
  } catch (err) {
    console.error('nearby places error:', err.message || err);
    return res.status(502).json({ error: 'Nearby places are temporarily unavailable' });
  }
});

module.exports = router;
