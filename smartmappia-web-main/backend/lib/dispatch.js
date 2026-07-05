// ---------------------------------------------------------------------
// Grab-style driver dispatch — shared by Pick & Drop rides and Food
// Delivery orders.
//
// Flow (per job):
//   1. A job becomes dispatchable (booking payment verified, or food
//      order accepted + paid).
//   2. The NEAREST online approved driver gets an exclusive offer with a
//      30-second window (dispatch_offers row + realtime push to their
//      device). "Online" = a GPS ping fresher than driverFreshMinutes.
//   3. Decline or timeout -> the offer cascades to the next-nearest
//      driver who hasn't seen this job yet.
//   4. When every candidate has passed (or none were online), the job
//      drops into the OPEN POOL — the classic first-come feed — so it is
//      never stuck waiting on the cascade.
//
// Double-claim safety is layered: the DB allows only one pending offer
// per job (partial unique index), accepting an offer is a
// compare-and-swap on the offer row, and the final claim is another
// compare-and-swap on the job itself (assigned_driver_id / deliveries
// .driver_id still null). Two drivers can never both win.
//
// The sweeper (expiring stale offers) runs in-process on the VPS server
// (started from server.js). State lives in the DB, so a restart resumes
// cleanly. On serverless there is no sweeper — jobs still reach drivers
// through the open-pool fallback.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { config } = require('./config');
const { haversineKm } = require('./geo');
const { broadcast, announceAvailableRide, pingFoodAdmin } = require('./realtime');
const { logNotification } = require('./notifications');

// --- Candidates --------------------------------------------------------

// Latest fresh GPS fix per approved driver: { driverId -> {lat,lng,at} }.
async function freshDriverLocations() {
  const since = new Date(Date.now() - config.dispatch.driverFreshMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('driver_locations')
    .select('driver_id, lat, lng, recorded_at, profiles!inner ( role, driver_approved )')
    .gte('recorded_at', since)
    .eq('profiles.role', 'driver')
    .eq('profiles.driver_approved', true)
    .order('recorded_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error('dispatch freshDriverLocations error:', error);
    return new Map();
  }
  const latest = new Map();
  for (const row of data || []) {
    if (!latest.has(row.driver_id)) {
      latest.set(row.driver_id, { lat: row.lat, lng: row.lng, at: row.recorded_at });
    }
  }
  return latest;
}

// Drivers who already saw this job (any offer status) — never re-offer.
async function alreadyOfferedDriverIds(target) {
  const column = target.kind === 'food' ? 'order_id' : 'booking_id';
  const { data } = await supabase
    .from('dispatch_offers')
    .select('driver_id')
    .eq(column, target.id);
  return new Set((data || []).map((r) => r.driver_id));
}

// Drivers currently holding ANY pending offer are busy deciding — skip them.
async function busyDriverIds() {
  const { data } = await supabase
    .from('dispatch_offers')
    .select('driver_id')
    .eq('status', 'pending');
  return new Set((data || []).map((r) => r.driver_id));
}

// --- Targets ------------------------------------------------------------
// target = { kind: 'food', id, code, merchantId, point: {lat,lng} | null }
//        | { kind: 'ride', id, code, point: {lat,lng} | null }

async function loadFoodTarget(orderId) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_code, status, payment_status, payment_method, merchant_id, merchants ( lat, lng, name, address )')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return null;
  const m = order.merchants;
  // Dispatchable once accepted and either paid up front or cash on delivery
  // (the rider collects the cash at the door).
  const paymentOk = order.payment_status === 'paid' || order.payment_method === 'cash';
  return {
    kind: 'food',
    id: order.id,
    code: order.order_code,
    merchantId: order.merchant_id,
    merchantName: m ? m.name : null,
    pickupAddress: m ? m.address : null,
    point: m && m.lat != null && m.lng != null ? { lat: m.lat, lng: m.lng } : null,
    active: ['accepted', 'preparing', 'ready'].includes(order.status) && paymentOk,
  };
}

async function loadRideTarget(bookingId) {
  const { data: b } = await supabase
    .from('bookings')
    .select('id, booking_code, booking_status, assigned_driver_id, pickup_address, pickup_lat, pickup_lng, ' +
      'dropoff_address, dropoff_lat, dropoff_lng, trip_type, airport_terminal, pickup_datetime, fare_amount, currency')
    .eq('id', bookingId)
    .maybeSingle();
  if (!b) return null;
  return {
    kind: 'ride',
    id: b.id,
    code: b.booking_code,
    booking: b,
    pickupAddress: b.pickup_address,
    point: b.pickup_lat != null && b.pickup_lng != null ? { lat: b.pickup_lat, lng: b.pickup_lng } : null,
    active: b.booking_status === 'confirmed' && !b.assigned_driver_id,
  };
}

// --- Open pool fallback ---------------------------------------------------
async function dropToOpenPool(target) {
  if (target.kind === 'food') {
    await supabase.from('deliveries').update({ status: 'open' })
      .eq('order_id', target.id).is('driver_id', null);
    broadcast('drivers-available', 'new_delivery', {
      orderCode: target.code,
      merchantName: target.merchantName,
      pickupAddress: target.pickupAddress,
    });
    pingFoodAdmin(target.code);
  } else {
    // Classic Pick & Drop behavior: visible to every online driver.
    announceAvailableRide({
      bookingCode: target.booking.booking_code,
      tripType: target.booking.trip_type,
      airportTerminal: target.booking.airport_terminal,
      pickupAddress: target.booking.pickup_address,
      pickupLat: target.booking.pickup_lat,
      pickupLng: target.booking.pickup_lng,
      dropoffAddress: target.booking.dropoff_address,
      dropoffLat: target.booking.dropoff_lat,
      dropoffLng: target.booking.dropoff_lng,
      pickupDatetime: target.booking.pickup_datetime,
      fareAmount: target.booking.fare_amount,
      currency: target.booking.currency,
    });
  }
}

// --- The cascade ------------------------------------------------------------
// Offer the job to the next-nearest driver who hasn't seen it. Returns true
// when an offer went out, false when the pool fallback kicked in.
async function offerNext(target) {
  if (!target || !target.active) return false;

  const [locations, seen, busy] = await Promise.all([
    freshDriverLocations(),
    alreadyOfferedDriverIds(target),
    busyDriverIds(),
  ]);

  const candidates = [...locations.entries()]
    .filter(([driverId]) => !seen.has(driverId) && !busy.has(driverId))
    .map(([driverId, loc]) => ({
      driverId,
      distanceKm: target.point ? haversineKm(loc, target.point) : null,
    }))
    .sort((a, b) => {
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });

  if (candidates.length === 0) {
    await dropToOpenPool(target);
    return false;
  }

  const next = candidates[0];
  const expiresAt = new Date(Date.now() + config.dispatch.offerSeconds * 1000).toISOString();
  const { data: offer, error } = await supabase
    .from('dispatch_offers')
    .insert({
      order_id: target.kind === 'food' ? target.id : null,
      booking_id: target.kind === 'ride' ? target.id : null,
      driver_id: next.driverId,
      round: seen.size + 1,
      distance_km: next.distanceKm != null ? Math.round(next.distanceKm * 10) / 10 : null,
      expires_at: expiresAt,
    })
    .select('id, expires_at')
    .single();
  if (error) {
    // Unique violation = a pending offer already exists (concurrent sweep) — fine.
    if (error.code !== '23505') console.error('dispatch offerNext insert error:', error);
    return false;
  }

  // Ping exactly that driver's device.
  broadcast(`driver-${next.driverId}`, 'new_offer', {
    offerId: offer.id,
    kind: target.kind,
    code: target.code,
    expiresAt: offer.expires_at,
    distanceKm: next.distanceKm != null ? Math.round(next.distanceKm * 10) / 10 : null,
  });
  logNotification({ userId: next.driverId, type: target.kind === 'food' ? 'delivery_offer' : 'ride_offer' });
  return true;
}

// --- Entry points -------------------------------------------------------------

// Food: called when an order is BOTH merchant-accepted and paid. Ensures the
// deliveries row exists (status 'searching') and starts the cascade.
async function startFoodDispatch(orderId) {
  try {
    const target = await loadFoodTarget(orderId);
    if (!target || !target.active) return;

    const { data: existing } = await supabase
      .from('deliveries')
      .select('id, driver_id, status')
      .eq('order_id', orderId)
      .maybeSingle();
    if (existing && existing.driver_id) return; // already has a rider

    if (!existing) {
      const { error } = await supabase
        .from('deliveries')
        .insert({ order_id: orderId, status: 'searching' });
      if (error && error.code !== '23505') {
        console.error('startFoodDispatch deliveries insert error:', error);
        return;
      }
    }
    await offerNext(target);
  } catch (err) {
    console.error('startFoodDispatch error:', err);
  }
}

// Rides: called from payment verification (replaces the old broadcast-to-all;
// that behavior is now the fallback when no online driver is found).
async function startRideDispatch(bookingId) {
  try {
    const target = await loadRideTarget(bookingId);
    if (!target || !target.active) return;
    await offerNext(target);
  } catch (err) {
    console.error('startRideDispatch error:', err);
  }
}

// --- Sweeper --------------------------------------------------------------
// Expire overdue pending offers and cascade each job to the next driver.
async function sweepExpiredOffers() {
  const now = new Date().toISOString();
  const { data: expired, error } = await supabase
    .from('dispatch_offers')
    .update({ status: 'expired', responded_at: now })
    .eq('status', 'pending')
    .lt('expires_at', now)
    .select('id, order_id, booking_id, driver_id');
  if (error) {
    console.error('dispatch sweep error:', error);
    return;
  }
  for (const offer of expired || []) {
    broadcast(`driver-${offer.driver_id}`, 'offer_expired', { offerId: offer.id });
    const target = offer.order_id
      ? await loadFoodTarget(offer.order_id)
      : await loadRideTarget(offer.booking_id);
    await offerNext(target);
  }
}

let sweeperStarted = false;
function startDispatchSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  setInterval(() => {
    sweepExpiredOffers().catch((err) => console.error('dispatch sweeper error:', err));
  }, config.dispatch.sweepMs);
  console.log(`Dispatch sweeper running (offers expire after ${config.dispatch.offerSeconds}s).`);
}

module.exports = {
  startFoodDispatch,
  startRideDispatch,
  offerNext,
  loadFoodTarget,
  loadRideTarget,
  sweepExpiredOffers,
  startDispatchSweeper,
};
