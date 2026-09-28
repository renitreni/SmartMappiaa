// ---------------------------------------------------------------------
// Geo helpers (pure). Used to sort the "nearest available" ride feed and
// to estimate a rough ETA from the driver to the pickup point.
// ---------------------------------------------------------------------
const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Great-circle distance in km.
function haversineKm(a, b) {
  if (a == null || b == null) return null;
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function etaMinutes(distanceKm, avgSpeedKmh = 30) {
  if (distanceKm == null) return null;
  const speed = avgSpeedKmh > 0 ? avgSpeedKmh : 30;
  return Math.max(1, Math.round((distanceKm / speed) * 60));
}

// Great-circle distance in metres — same math as haversineKm, just the unit
// a geofence check actually wants to compare against a radius in meters.
function distanceMeters(a, b) {
  const km = haversineKm(a, b);
  return km == null ? null : km * 1000;
}

// A reverse geocode returns several candidates for one point, and in KSA the
// first is often a plus code ("8HQ2+X4 Riyadh") that names nowhere a rider
// can find. Prefer a real street address, then anything that is not a plus
// code. street/buildingNumber are '' when Google has none, which is common
// here: the customer fills them in.
function placeFromReverseGeocode(results, lat, lng) {
  const list = Array.isArray(results) ? results : [];
  const is = (r, type) => (r.types || []).includes(type);
  const top =
    list.find((r) => is(r, 'street_address') || is(r, 'premise')) ||
    list.find((r) => !is(r, 'plus_code')) ||
    list[0];
  if (!top) return null;

  const part = (type) =>
    ((top.address_components || []).find((c) => (c.types || []).includes(type)) || {}).long_name || '';
  const at = top.geometry && top.geometry.location;
  return {
    id: String(top.place_id || `${lat},${lng}`),
    name: (top.formatted_address || '').split(',')[0] || 'Selected location',
    address: top.formatted_address || '',
    lat: at && Number.isFinite(Number(at.lat)) ? Number(at.lat) : lat,
    lng: at && Number.isFinite(Number(at.lng)) ? Number(at.lng) : lng,
    type: (top.types && top.types[0]) || 'place',
    street: part('route'),
    buildingNumber: part('street_number') || part('premise'),
  };
}

module.exports = { haversineKm, etaMinutes, distanceMeters, placeFromReverseGeocode };
