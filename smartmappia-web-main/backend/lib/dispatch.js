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
const {
  broadcast,
  announceAvailableRide,
  pingFoodAdmin,
  pingAdmin,
  pushFoodOrderStatus,
  pushMerchantFeed,
  pushBookingStatus,
} = require('./realtime');
const { logNotification } = require('./notifications');
const { logAudit } = require('./audit');
const { SERVICE_TYPES } = require('./serviceTypes');

// --- Candidates --------------------------------------------------------

// Latest fresh GPS fix per approved driver: { driverId -> {lat,lng,at,services} }.
async function freshDriverLocations() {
  const since = new Date(Date.now() - config.dispatch.driverFreshMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('driver_locations')
    .select('driver_id, lat, lng, recorded_at, profiles!inner ( role, driver_approved, service_types )')
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
      latest.set(row.driver_id, {
        lat: row.lat,
        lng: row.lng,
        at: row.recorded_at,
        services: row.profiles.service_types || SERVICE_TYPES,
      });
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
      'dropoff_address, dropoff_lat, dropoff_lng, trip_type, airport_terminal, pickup_datetime, fare_amount, currency, payment_method')
    .eq('id', bookingId)
    .maybeSingle();
  if (!b) return null;
  return {
    kind: 'ride',
    id: b.id,
    code: b.booking_code,
    booking: b,
    paymentMethod: b.payment_method,
    pickupAddress: b.pickup_address,
    point: b.pickup_lat != null && b.pickup_lng != null ? { lat: b.pickup_lat, lng: b.pickup_lng } : null,
    active: b.booking_status === 'confirmed' && !b.assigned_driver_id,
  };
}

// Drivers who owe SmartMappia at/over the cash cap. Coarse gate for cash-ride
// OFFERS (uses the shared config limit, not per-driver overrides) so we don't
// hand a cash ride to someone who'd be blocked from accepting it; the precise
// per-driver block lives in acceptRide / claimRide.
async function overCashCapDriverIds() {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .gte('cash_owed', config.ledger.cashOwedLimit);
  return new Set((data || []).map((r) => r.id));
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

  // For cash rides, also exclude drivers over their cash-owed cap up front.
  const isCashRide = target.kind === 'ride' && target.paymentMethod === 'cash';
  const [locations, seen, busy, overCap] = await Promise.all([
    freshDriverLocations(),
    alreadyOfferedDriverIds(target),
    busyDriverIds(),
    isCashRide ? overCashCapDriverIds() : Promise.resolve(new Set()),
  ]);

  // Only drivers who opted into this vertical (service_types, 0020).
  const requiredService = target.kind === 'food' ? 'food' : 'pick_drop';
  const candidates = [...locations.entries()]
    .filter(
      ([driverId, loc]) =>
        !seen.has(driverId) &&
        !busy.has(driverId) &&
        !overCap.has(driverId) &&
        loc.services.includes(requiredService)
    )
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
  logNotification({
    userId: next.driverId,
    bookingId: target.kind === 'ride' ? target.id : null,
    orderId: target.kind === 'food' ? target.id : null,
    type: target.kind === 'food' ? 'delivery_offer' : 'ride_offer',
    code: target.code,
    url: '/driver',
  });
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

// --- Release + re-dispatch (driver cancel / disconnect) -----------------------
// Return a food delivery to the cascade. ONLY valid BEFORE pickup (delivery
// status still 'assigned'); once the rider has the food it's a manual case.
// Shared by the driver-cancel endpoint and the disconnect watchdog.
// cause: 'cancelled' (driver bailed) | 'reclaimed' (driver went dark).
async function releaseFoodDelivery(
  orderId,
  { previousDriverId = null, reason = null, cause = 'cancelled', actorId = null } = {}
) {
  // Atomic release: only if still assigned (guards against a pickup landing first).
  const { data: released, error } = await supabase
    .from('deliveries')
    .update({ driver_id: null, status: 'searching' })
    .eq('order_id', orderId)
    .eq('status', 'assigned')
    .select('id');
  if (error) {
    console.error('releaseFoodDelivery error:', error);
    return false;
  }
  if (!released || released.length === 0) return false; // already picked up / taken over

  const { data: order } = await supabase
    .from('orders')
    .select('order_code, customer_id, merchant_id, status')
    .eq('id', orderId)
    .maybeSingle();

  if (order) {
    logAudit({
      actorId: actorId || previousDriverId || null,
      action: cause === 'reclaimed' ? 'driver_delivery_reclaimed' : 'driver_delivery_cancelled',
      resourceType: 'order',
      resourceId: order.order_code,
      meta: { previous_driver_id: previousDriverId, reason },
    });
    // Customer: "finding you a new rider". Old rider: the job left them.
    logNotification({ userId: order.customer_id, type: 'food_finding_new_rider', code: order.order_code });
    if (previousDriverId) {
      logNotification({
        userId: previousDriverId,
        type: cause === 'reclaimed' ? 'food_delivery_reclaimed' : 'food_delivery_cancelled',
        code: order.order_code,
      });
    }
    // Drop the rider card on the customer's tracking page + refresh admin/merchant.
    pushFoodOrderStatus(order.order_code, { status: order.status, rider: null });
    pushMerchantFeed(order.merchant_id, 'order_update', { orderCode: order.order_code, riderAssigned: false });
    pingFoodAdmin(order.order_code);
  }

  // Re-run the nearest-driver cascade (the canceller is excluded automatically
  // because they already appear in dispatch_offers for this job).
  await offerNext(await loadFoodTarget(orderId));
  return true;
}

// Watchdog: a rider who accepted but whose GPS has gone silent past
// abandonMinutes (and hasn't picked up yet) is treated as disconnected — the
// order is released and re-offered. Runs in-process on the VPS alongside the
// offer sweeper (no watchdog on serverless; the open pool still catches jobs).
async function sweepAbandonedDeliveries() {
  const staleBefore = Date.now() - config.dispatch.abandonMinutes * 60 * 1000;
  const { data: rows, error } = await supabase
    .from('deliveries')
    .select('order_id, driver_id, orders!inner ( status )')
    .eq('status', 'assigned')
    .not('driver_id', 'is', null)
    .in('orders.status', ['accepted', 'preparing', 'ready']);
  if (error) {
    console.error('sweepAbandonedDeliveries error:', error);
    return;
  }
  for (const row of rows || []) {
    const { data: loc } = await supabase
      .from('driver_locations')
      .select('recorded_at')
      .eq('driver_id', row.driver_id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastSeen = loc ? new Date(loc.recorded_at).getTime() : 0;
    if (lastSeen < staleBefore) {
      await releaseFoodDelivery(row.order_id, {
        previousDriverId: row.driver_id,
        cause: 'reclaimed',
        reason: 'rider_disconnected',
      });
    }
  }
}

// Return a Pick & Drop booking to the cascade. Valid only BEFORE the trip
// starts (driver_ride_status accepted/on_the_way/arrived); once 'started' the
// passenger is in the car. cause: 'cancelled' (driver) | 'reclaimed' (watchdog).
async function releaseRide(
  bookingId,
  { previousDriverId = null, reason = null, cause = 'cancelled', actorId = null } = {}
) {
  // Atomic release: only the current driver, only pre-start.
  const { data: released, error } = await supabase
    .from('bookings')
    .update({ assigned_driver_id: null, driver_ride_status: null, booking_status: 'confirmed' })
    .eq('id', bookingId)
    .eq('assigned_driver_id', previousDriverId)
    .in('driver_ride_status', ['accepted', 'on_the_way', 'arrived'])
    .select('id, booking_code, user_id');
  if (error) {
    console.error('releaseRide error:', error);
    return false;
  }
  if (!released || released.length === 0) return false; // trip started / already released
  const booking = released[0];

  logAudit({
    actorId: actorId || previousDriverId || null,
    action: cause === 'reclaimed' ? 'driver_ride_reclaimed' : 'driver_ride_cancelled',
    resourceType: 'booking',
    resourceId: booking.booking_code,
    meta: { previous_driver_id: previousDriverId, reason },
  });
  logNotification({ userId: booking.user_id, bookingId: booking.id, type: 'ride_finding_new_driver', code: booking.booking_code });
  if (previousDriverId) {
    logNotification({
      userId: previousDriverId,
      type: cause === 'reclaimed' ? 'ride_reclaimed' : 'ride_cancelled_by_you',
      code: booking.booking_code,
    });
  }
  // Drop the driver on the passenger's tracking page + refresh admin.
  pushBookingStatus(booking.booking_code, { bookingStatus: 'confirmed', driverRideStatus: null, driver: null });
  pingAdmin(booking.booking_code);

  await offerNext(await loadRideTarget(bookingId));
  return true;
}

// Ride disconnect watchdog. Deliberately narrower than the food one: only rides
// the driver has actively started heading to (on_the_way/arrived), NOT merely
// 'accepted' — a driver may accept a SCHEDULED ride hours ahead and not be
// pinging GPS yet, and we must not reclaim those.
async function sweepAbandonedRides() {
  const staleBefore = Date.now() - config.dispatch.abandonMinutes * 60 * 1000;
  const { data: rows, error } = await supabase
    .from('bookings')
    .select('id, assigned_driver_id')
    .not('assigned_driver_id', 'is', null)
    .in('driver_ride_status', ['on_the_way', 'arrived']);
  if (error) {
    console.error('sweepAbandonedRides error:', error);
    return;
  }
  for (const b of rows || []) {
    const { data: loc } = await supabase
      .from('driver_locations')
      .select('recorded_at')
      .eq('driver_id', b.assigned_driver_id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastSeen = loc ? new Date(loc.recorded_at).getTime() : 0;
    if (lastSeen < staleBefore) {
      await releaseRide(b.id, {
        previousDriverId: b.assigned_driver_id,
        cause: 'reclaimed',
        reason: 'driver_disconnected',
      });
    }
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
  // Disconnect watchdog (food + rides) runs less often than the offer sweeper
  // (abandonMinutes is minutes, not seconds) to keep per-driver lookups cheap.
  setInterval(() => {
    sweepAbandonedDeliveries().catch((err) => console.error('dispatch abandon (food) sweep error:', err));
    sweepAbandonedRides().catch((err) => console.error('dispatch abandon (ride) sweep error:', err));
  }, Math.max(config.dispatch.sweepMs, 20000));
  console.log(
    `Dispatch sweeper running (offers expire after ${config.dispatch.offerSeconds}s; ` +
      `rider disconnect watchdog after ${config.dispatch.abandonMinutes}m).`
  );
}

module.exports = {
  startFoodDispatch,
  startRideDispatch,
  offerNext,
  loadFoodTarget,
  loadRideTarget,
  releaseFoodDelivery,
  releaseRide,
  sweepExpiredOffers,
  sweepAbandonedDeliveries,
  sweepAbandonedRides,
  startDispatchSweeper,
};
