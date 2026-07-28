// ---------------------------------------------------------------------
// Geo helpers (pure). Used to sort the "nearest available" ride feed and
// to estimate a rough ETA from the driver to the pickup point.
// ---------------------------------------------------------------------
const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Great-circle distance in kilometres between two {lat,lng} points.
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

// Rough ETA in minutes from a distance, assuming an average city speed.
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

module.exports = { haversineKm, etaMinutes, distanceMeters };
