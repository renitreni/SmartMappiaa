// ---------------------------------------------------------------------
// GPS-vicinity ("geofence") check before a driver may mark arrived /
// picked_up / delivered — see backend/lib/config.js's `geofence` block.
//
// Fails CLOSED: with no coordinates at all (from either source), the driver
// is rejected, not silently let through — the whole point of this check is
// that these transitions were previously fully trusted, unchecked client
// claims.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { config } = require('./config');
const { distanceMeters } = require('./geo');

// Prefer a fresh coordinate pair sent with the status-change request itself
// (a synchronous GPS read at the moment of the tap — no staleness concern).
// Fall back to the driver's latest stored ping only if it's recent enough
// to trust; POST /api/driver/location pings land every ~12s while online,
// so a few minutes' tolerance comfortably covers normal gaps without
// accepting a fix from long before the driver arrived.
async function resolveDriverPosition(driverId, bodyLat, bodyLng) {
  if (Number.isFinite(bodyLat) && Number.isFinite(bodyLng)) {
    return { lat: bodyLat, lng: bodyLng };
  }

  const { data: loc, error } = await supabase
    .from('driver_locations')
    .select('lat, lng, recorded_at')
    .eq('driver_id', driverId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('resolveDriverPosition lookup error:', error);
    return null;
  }
  if (!loc) return null;

  const ageMs = Date.now() - new Date(loc.recorded_at).getTime();
  if (ageMs > config.geofence.maxFixAgeMinutes * 60 * 1000) return null;

  return { lat: loc.lat, lng: loc.lng };
}

// Returns null when the driver is within radius (pass), or an
// { httpStatus, body } error payload for the caller to return directly.
async function assertWithinGeofence({ driverId, target, radiusMeters, bodyLat, bodyLng }) {
  if (!config.geofence.enabled) return null;
  if (!target || target.lat == null || target.lng == null) return null; // nothing to check against

  const driverPos = await resolveDriverPosition(driverId, bodyLat, bodyLng);
  if (!driverPos) {
    return {
      httpStatus: 409,
      body: {
        error: 'Could not confirm your location — enable GPS and try again.',
        failure_reason: 'location_unavailable',
      },
    };
  }

  const distance = distanceMeters(driverPos, target);
  if (distance != null && distance > radiusMeters) {
    return {
      httpStatus: 409,
      body: {
        error: `You're ${Math.round(distance)}m away — get closer before confirming.`,
        failure_reason: 'too_far_from_target',
        distanceMeters: Math.round(distance),
        allowedRadiusMeters: radiusMeters,
      },
    };
  }

  return null;
}

module.exports = { resolveDriverPosition, assertWithinGeofence };
