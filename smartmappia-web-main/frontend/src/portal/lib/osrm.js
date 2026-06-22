// ---------------------------------------------------------------------
// Road-route helper backed by the public OSRM demo server.
//
// fetchRoute(from, to) returns the real driving route geometry + a
// route-based distance/ETA. It is best-effort: on any failure (network,
// CORS, timeout, no route) it resolves to `null` so callers fall back to a
// straight line + their existing crow-flies ETA. No external dependency —
// uses the browser `fetch`.
// ---------------------------------------------------------------------

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

function valid(p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/**
 * @param {{lat:number,lng:number}} from
 * @param {{lat:number,lng:number}} to
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{coords:{lat:number,lng:number}[], distanceKm:number, durationMin:number}|null>}
 */
export async function fetchRoute(from, to, opts = {}) {
  if (!valid(from) || !valid(to)) return null;

  const timeoutMs = opts.timeoutMs ?? 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // OSRM expects lng,lat order.
    const coordsPath = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${OSRM_BASE}/${coordsPath}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const data = await res.json();
    const route = data?.routes?.[0];
    const ring = route?.geometry?.coordinates;
    if (!Array.isArray(ring) || ring.length < 2) return null;

    // GeoJSON is [lng, lat] — flip to our {lat, lng}.
    const coords = ring
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map(([lng, lat]) => ({ lat, lng }));
    if (coords.length < 2) return null;

    return {
      coords,
      distanceKm: route.distance != null ? route.distance / 1000 : null,
      durationMin: route.duration != null ? Math.max(1, Math.round(route.duration / 60)) : null,
    };
  } catch {
    // Aborted / network / parse error -> let the caller fall back.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
