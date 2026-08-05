// ---------------------------------------------------------------------
// Google Routes API (Compute Routes) — the one place we speak to it.
//
// Lifted out of routes/route.js so the ETA layer (lib/eta.js) can ask for a
// driving duration without going back out through our own HTTP surface.
// route.js is now a thin proxy over this; both get the same field mask, the
// same key handling and the same "no route found" semantics.
//
// GOOGLE_MAPS_SERVER_KEY stays server-side. Never expose it to a client —
// the browser reaches this through /api/route, same-origin.
// ---------------------------------------------------------------------
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

function isPoint(p) {
  return p != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
}

// Ask Google for the driving route between two points.
//
// Returns { ok: true, encodedPolyline, distanceMeters, durationSeconds } —
// where every field may still be null if Google found no route — or
// { ok: false, reason } on a bad input, a missing key, or an upstream
// failure. NEVER throws: every caller has a usable fallback (a straight
// line on the map, a haversine estimate for an ETA) and an exception here
// would take down a page for a nicety.
async function computeRoute({ from, to }) {
  if (!isPoint(from) || !isPoint(to)) {
    return { ok: false, reason: 'invalid_coordinates' };
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    console.error('googleRoutes: GOOGLE_MAPS_SERVER_KEY is not set');
    return { ok: false, reason: 'not_configured' };
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
        origin: { location: { latLng: { latitude: Number(from.lat), longitude: Number(from.lng) } } },
        destination: { location: { latLng: { latitude: Number(to.lat), longitude: Number(to.lng) } } },
        travelMode: 'DRIVE',
        polylineEncoding: 'ENCODED_POLYLINE',
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error('routes api error:', upstream.status, text.slice(0, 300));
      return { ok: false, reason: 'upstream_error' };
    }

    const data = await upstream.json();
    const route = data?.routes?.[0];
    if (!route?.polyline?.encodedPolyline) {
      // No route found — the caller falls back to a straight line.
      return { ok: true, encodedPolyline: null, distanceMeters: null, durationSeconds: null };
    }

    // Routes API returns duration as a string like "1234s".
    const durationSec = route.duration ? parseInt(String(route.duration).replace('s', ''), 10) : null;
    return {
      ok: true,
      encodedPolyline: route.polyline.encodedPolyline,
      distanceMeters: route.distanceMeters ?? null,
      durationSeconds: Number.isFinite(durationSec) ? durationSec : null,
    };
  } catch (err) {
    console.error('googleRoutes error:', err.message || err);
    return { ok: false, reason: 'upstream_error' };
  }
}

module.exports = { computeRoute };
