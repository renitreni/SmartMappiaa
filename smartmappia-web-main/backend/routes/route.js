const express = require('express');
const router = express.Router();
const { routeLimiter } = require('../middleware/rateLimiters');

// ---------------------------------------------------------------------
// Driving-route proxy backed by the Google Routes API (Compute Routes).
// Replaces the old self-hosted OSRM proxy. The GOOGLE_MAPS_SERVER_KEY stays
// server-side; the browser calls this same-origin under /api. Returns the
// encoded polyline + distance/duration; the frontend (lib/osrm.js) decodes
// the polyline and falls back to a straight line if this is unavailable.
//
//   GET /api/route?from=LAT,LNG&to=LAT,LNG
// ---------------------------------------------------------------------
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

function parseLatLng(value) {
  if (!value) return null;
  const [lat, lng] = String(value).split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

router.get('/', routeLimiter, async (req, res) => {
  const from = parseLatLng(req.query.from);
  const to = parseLatLng(req.query.to);
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to are required as "lat,lng"' });
  }
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    console.error('route proxy: GOOGLE_MAPS_SERVER_KEY is not set');
    return res.status(502).json({ error: 'Routing service not configured' });
  }

  try {
    const upstream = await fetch(ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Field mask is required and keeps us on the cheaper Essentials SKU.
        'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE',
        polylineEncoding: 'ENCODED_POLYLINE',
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error('routes api error:', upstream.status, text.slice(0, 300));
      return res.status(502).json({ error: 'Routing service unavailable' });
    }

    const data = await upstream.json();
    const route = data?.routes?.[0];
    if (!route?.polyline?.encodedPolyline) {
      // No route found — let the caller fall back to a straight line.
      return res.json({ encodedPolyline: null, distanceMeters: null, duration: null });
    }
    // Routes API returns duration as a string like "1234s".
    const durationSec = route.duration ? parseInt(String(route.duration).replace('s', ''), 10) : null;
    return res.json({
      encodedPolyline: route.polyline.encodedPolyline,
      distanceMeters: route.distanceMeters ?? null,
      duration: Number.isFinite(durationSec) ? durationSec : null,
    });
  } catch (err) {
    console.error('route proxy error:', err.message || err);
    return res.status(502).json({ error: 'Routing service unavailable' });
  }
});

module.exports = router;
