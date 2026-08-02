// ---------------------------------------------------------------------
// tracking_events helper.
//
// Every meaningful state change appends a timeline row that drives the
// Grab-style tracking page (spec §7). Centralized so controllers stay thin
// and event writes look identical everywhere.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { config } = require('./config');

// Append one timeline event. Best-effort: a failed event write must never
// break the primary action, so we surface the error to the caller to log
// but callers generally do not abort on it.
async function addTrackingEvent(bookingId, { eventType, title, message, createdByUserId = null }) {
  const { error } = await supabase.from('tracking_events').insert({
    booking_id: bookingId,
    event_type: eventType,
    title: title ?? null,
    message: message ?? null,
    created_by_user_id: createdByUserId,
  });
  return { error };
}

// The driver's most recent GPS fix, or null if it is too old to be believed.
//
// Every live map on the platform (ride tracking, food, shop) asks this same
// question, so the freshness rule lives here once rather than being re-derived
// per vertical. Without the age gate a driver whose phone died mid-trip keeps
// rendering as a confident, stationary dot forever — worse than showing no dot
// at all, because the customer waits on it instead of calling.
//
// Reuses config.dispatch.driverFreshMinutes: it is already the platform's
// definition of "this driver is live" (it decides who is eligible for an
// offer), so a driver too stale to dispatch to is exactly a driver too stale
// to draw. Deliberately NOT a second knob that could drift out of step.
//
// Returns { lat, lng, at, heading, speedKmh } | null.
async function latestDriverFix(driverId) {
  if (!driverId) return null;
  const { data, error } = await supabase
    .from('driver_locations')
    .select('lat, lng, recorded_at, heading, speed_kmh')
    .eq('driver_id', driverId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  const ageMs = Date.now() - new Date(data.recorded_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs > config.dispatch.driverFreshMinutes * 60 * 1000) return null;

  return {
    lat: data.lat,
    lng: data.lng,
    at: data.recorded_at,
    heading: data.heading,
    speedKmh: data.speed_kmh,
  };
}

module.exports = { addTrackingEvent, latestDriverFix };
