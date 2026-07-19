// ---------------------------------------------------------------------
// Driver controller (all routes gated by requireDriver; req.driverId set)
//   - listAvailableRides : GET  /api/driver/available   (Grab-style feed)
//   - acceptRide         : POST /api/driver/rides/:code/accept (atomic claim)
//   - updateDriverLocation: POST /api/driver/location     (live position)
//   - listMyRides        : GET  /api/driver/rides
//   - updateRideStatus   : POST /api/driver/rides/:code/status
//   - updateServiceTypes : PATCH /api/driver/services (verticals worked)
//
// A driver may only see/update rides assigned to them. Accepting a ride is
// first-come-first-served: the claim only succeeds while the booking is
// still unassigned. Completing a ride writes the ledger (spec §12).
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { addTrackingEvent } = require('../lib/tracking');
const { createLedgerEntryForBooking } = require('../lib/ledger');
const { round2, isBlockedFromCash, driverCashView, chargeDriverCashOwed } = require('../lib/driverCash');
const { haversineKm, etaMinutes } = require('../lib/geo');
const { logNotification } = require('../lib/notifications');
const { hasService } = require('../lib/serviceTypes');
const {
  pushBookingStatus,
  announceRequestTaken,
  pingAdmin,
  pushFoodOrderStatus,
} = require('../lib/realtime');

// driver_ride_status value -> resulting booking_status + human title +
// the notification type recorded in the passenger's bell (spec section 5).
const STATUS_FLOW = {
  accepted:   { bookingStatus: 'driver_assigned',   title: 'Driver accepted',   message: 'Your driver accepted the trip.', notify: 'ride_driver_accepted' },
  on_the_way: { bookingStatus: 'driver_on_the_way', title: 'Driver on the way', message: 'Your driver is on the way to your pickup.', notify: 'ride_driver_on_the_way' },
  arrived:    { bookingStatus: 'arrived',           title: 'Driver arrived',    message: 'Your driver has arrived at the pickup point.', notify: 'ride_driver_arrived' },
  started:    { bookingStatus: 'in_progress',       title: 'Trip started',      message: 'Your trip has started.', notify: 'ride_trip_started' },
  completed:  { bookingStatus: 'completed',         title: 'Trip completed',    message: 'Your trip is complete. Thank you for riding with Smart Mappia.', notify: 'ride_completed' },
  cancelled:  { bookingStatus: 'cancelled',         title: 'Trip cancelled',    message: 'This trip was cancelled by the driver.', notify: 'ride_cancelled' },
};

// Ride states where the driver is actively heading to / carrying the rider.
const ACTIVE_RIDE_STATUSES = ['accepted', 'on_the_way', 'arrived', 'started'];

// --- GET /api/driver/available ---------------------------------------
// Verified + confirmed + still unassigned bookings, nearest first.
async function listAvailableRides(req, res) {
  try {
    // Drivers who turned Pick & Drop off see an empty feed (200, not 403 —
    // the frontend polls this silently). Admin preview bypasses.
    if (req.role !== 'admin' && !hasService(req.profile, 'pick_drop')) {
      return res.json({ rides: [] });
    }

    const lat = req.query.lat != null ? Number(req.query.lat) : null;
    const lng = req.query.lng != null ? Number(req.query.lng) : null;
    const here = lat != null && lng != null ? { lat, lng } : null;

    const { data, error } = await supabase
      .from('bookings')
      .select(
        'booking_code, trip_type, airport_terminal, pickup_address, pickup_lat, pickup_lng, ' +
          'dropoff_address, dropoff_lat, dropoff_lng, pickup_datetime, fare_amount, currency, ' +
          'payment_method, created_at'
      )
      // Cash bookings are confirmed up front (no online payment to verify),
      // so a verified payment OR a cash method makes a ride dispatchable.
      .or('payment_status.eq.verified,payment_method.eq.cash')
      .eq('booking_status', 'confirmed')
      .is('assigned_driver_id', null)
      .order('created_at', { ascending: true });
    if (error) { console.error('driver query error:', error); return res.status(500).json({ error: 'Unexpected server error' }); }

    // A driver over their cash-owed cap can't accept cash rides, so don't
    // show them ones they'd only be blocked from taking (STC rides still show).
    let feed = data || [];
    if (req.role !== 'admin') {
      const { data: drv } = await supabase
        .from('profiles')
        .select('cash_owed, cash_owed_limit')
        .eq('id', req.driverId)
        .single();
      if (drv && isBlockedFromCash(drv)) {
        feed = feed.filter((r) => r.payment_method !== 'cash');
      }
    }

    const rides = feed.map((r) => {
      const distanceKm = here
        ? haversineKm(here, { lat: r.pickup_lat, lng: r.pickup_lng })
        : null;
      return {
        ...r,
        distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
        etaMinutes: etaMinutes(distanceKm),
      };
    });

    // Nearest first when we know where the driver is; nulls go last.
    rides.sort((a, b) => {
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });

    return res.json({ rides });
  } catch (err) {
    console.error('listAvailableRides error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- POST /api/driver/rides/:bookingCode/accept ----------------------
async function acceptRide(req, res) {
  try {
    if (req.role !== 'admin' && !hasService(req.profile, 'pick_drop')) {
      return res.status(403).json({ error: 'Enable Pick & Drop in your services to accept rides' });
    }

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, booking_code, payment_status, payment_method, booking_status, assigned_driver_id, user_id')
      .eq('booking_code', req.params.bookingCode)
      .single();
    if (error || !booking) return res.status(404).json({ error: 'Ride not found' });
    // Cash rides are ready on creation; STC Pay rides only once verified.
    if (booking.payment_status !== 'verified' && booking.payment_method !== 'cash') {
      return res.status(409).json({ error: 'Ride is not ready to be accepted yet' });
    }
    // Hard block: a driver who owes SmartMappia at/over their cap cannot take
    // on more cash (they'd be holding even more of our money). STC rides are
    // unaffected — no cash changes hands.
    if (booking.payment_method === 'cash') {
      const { data: drv } = await supabase
        .from('profiles')
        .select('cash_owed, cash_owed_limit')
        .eq('id', req.driverId)
        .single();
      if (drv && isBlockedFromCash(drv)) {
        return res.status(403).json({
          error: 'Settle your outstanding cash with SmartMappia before taking new cash rides',
          failure_reason: 'cash_owed_limit_reached',
          cash: driverCashView(drv),
        });
      }
    }
    if (booking.assigned_driver_id) {
      return res.status(409).json({ error: 'Ride already taken' });
    }

    // Atomic claim: only succeeds while assigned_driver_id is STILL null, so
    // two drivers tapping "accept" at once can never both win.
    const { data: claimed, error: claimErr } = await supabase
      .from('bookings')
      .update({
        assigned_driver_id: req.driverId,
        driver_ride_status: 'accepted',
        booking_status: 'driver_assigned',
      })
      .eq('id', booking.id)
      .is('assigned_driver_id', null)
      .select('booking_code, booking_status, driver_ride_status')
      .single();
    if (claimErr || !claimed) {
      return res.status(409).json({ error: 'Ride already taken' });
    }

    // Driver contact for the passenger's tracking screen.
    const { data: driver } = await supabase
      .from('profiles')
      .select('full_name, whatsapp_number')
      .eq('id', req.driverId)
      .single();

    await addTrackingEvent(booking.id, {
      eventType: 'driver_accepted',
      title: 'Driver accepted',
      message: `${(driver && driver.full_name) || 'A driver'} accepted your trip and is on the way.`,
      createdByUserId: req.driverId,
    });

    const driverPayload = driver
      ? { name: driver.full_name, whatsapp: driver.whatsapp_number }
      : null;
    pushBookingStatus(booking.booking_code, {
      bookingStatus: 'driver_assigned',
      driverRideStatus: 'accepted',
      driver: driverPayload,
    });
    announceRequestTaken(booking.booking_code);
    logNotification({
      userId: booking.user_id,
      bookingId: booking.id,
      type: 'ride_driver_accepted',
      code: booking.booking_code,
    });

    return res.json({
      bookingCode: claimed.booking_code,
      bookingStatus: claimed.booking_status,
      driverRideStatus: claimed.driver_ride_status,
      driver: driverPayload,
    });
  } catch (err) {
    console.error('acceptRide error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- POST /api/driver/location ---------------------------------------
// Driver app posts GPS periodically. We store it and push it live to the
// passenger(s) whose active ride this driver is currently handling.
async function updateDriverLocation(req, res) {
  try {
    const { lat, lng, accuracy } = req.body || {};
    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const { error } = await supabase.from('driver_locations').insert({
      driver_id: req.driverId,
      lat: Number(lat),
      lng: Number(lng),
      accuracy_meters: accuracy != null ? Number(accuracy) : null,
    });
    if (error) { console.error('driver query error:', error); return res.status(500).json({ error: 'Unexpected server error' }); }

    // Push live position to any active ride this driver is on.
    const { data: activeRides } = await supabase
      .from('bookings')
      .select('booking_code, pickup_lat, pickup_lng')
      .eq('assigned_driver_id', req.driverId)
      .in('driver_ride_status', ACTIVE_RIDE_STATUSES);

    const at = new Date().toISOString();
    (activeRides || []).forEach((r) => {
      const distanceKm = haversineKm(
        { lat: Number(lat), lng: Number(lng) },
        { lat: r.pickup_lat, lng: r.pickup_lng }
      );
      pushBookingStatus(r.booking_code, {
        driverLocation: { lat: Number(lat), lng: Number(lng), at },
        etaMinutes: etaMinutes(distanceKm),
      });
    });

    // Same for any food delivery this driver is carrying — the customer's
    // tracking map moves the rider pin on every ping (Grab-style).
    const { data: activeDeliveries } = await supabase
      .from('deliveries')
      .select('order_id, orders!inner ( order_code, status, delivery_lat, delivery_lng )')
      .eq('driver_id', req.driverId)
      .in('orders.status', ['accepted', 'preparing', 'ready', 'out_for_delivery']);

    (activeDeliveries || []).forEach((d) => {
      const o = d.orders;
      const distanceKm = haversineKm(
        { lat: Number(lat), lng: Number(lng) },
        { lat: o.delivery_lat, lng: o.delivery_lng }
      );
      pushFoodOrderStatus(o.order_code, {
        status: o.status,
        riderLocation: { lat: Number(lat), lng: Number(lng), at },
        riderEtaMinutes: etaMinutes(distanceKm),
      });
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('updateDriverLocation error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- GET /api/driver/rides -------------------------------------------
async function listMyRides(req, res) {
  try {
    let query = supabase
      .from('bookings')
      .select(
        'booking_code, trip_type, airport_terminal, pickup_address, pickup_lat, pickup_lng, ' +
          'dropoff_address, dropoff_lat, dropoff_lng, pickup_datetime, passenger_name, ' +
          'passenger_whatsapp, fare_amount, currency, booking_status, driver_ride_status, created_at'
      )
      .eq('assigned_driver_id', req.driverId)
      .order('pickup_datetime', { ascending: true });

    if (req.query.driver_ride_status) {
      query = query.eq('driver_ride_status', req.query.driver_ride_status);
    }

    const { data, error } = await query;
    if (error) { console.error('driver query error:', error); return res.status(500).json({ error: 'Unexpected server error' }); }

    return res.json({ rides: data });
  } catch (err) {
    console.error('listMyRides error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- POST /api/driver/rides/:bookingCode/status ----------------------
async function updateRideStatus(req, res) {
  try {
    const status = req.body && req.body.status;
    if (!status || !STATUS_FLOW[status]) {
      return res.status(400).json({
        error: `status is required and must be one of: ${Object.keys(STATUS_FLOW).join(', ')}`,
      });
    }

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, booking_code, fare_amount, currency, payment_method, payment_status, ' +
        'assigned_driver_id, driver_ride_status, booking_status, user_id')
      .eq('booking_code', req.params.bookingCode)
      .single();
    if (error || !booking) return res.status(404).json({ error: 'Ride not found' });
    if (booking.assigned_driver_id !== req.driverId) {
      return res.status(403).json({ error: 'This ride is not assigned to you' });
    }
    if (booking.driver_ride_status === 'completed') {
      return res.status(409).json({ error: 'Ride already completed' });
    }

    const flow = STATUS_FLOW[status];
    const { data: updated, error: updErr } = await supabase
      .from('bookings')
      .update({ driver_ride_status: status, booking_status: flow.bookingStatus })
      .eq('id', booking.id)
      .select('booking_code, driver_ride_status, booking_status')
      .single();
    if (updErr) { console.error('driver update error:', updErr); return res.status(500).json({ error: 'Unexpected server error' }); }

    await addTrackingEvent(booking.id, {
      eventType: `driver_${status}`,
      title: flow.title,
      message: flow.message,
      createdByUserId: req.driverId,
    });

    // Increment 6: completing the ride creates the ledger / payout entry.
    let ledger = null;
    if (status === 'completed') {
      const result = await createLedgerEntryForBooking({ booking, driverId: req.driverId });
      if (result.error) {
        console.error('ledger creation error:', result.error);
        return res.status(500).json({ error: 'Ride completed but ledger creation failed' });
      }
      ledger = {
        driverNet: result.ledger.driver_net,
        platformNet: result.ledger.platform_net,
        payoutStatus: result.ledger.payout_status,
      };

      // Cash rides settle at handover: the driver has now collected the
      // fare, so mark the booking paid and log the collection. Best-effort
      // — a failure here must not fail the (already applied) completion.
      // The ledger still models "platform holds fare, owes driver"; for cash
      // the driver is holding it, so we ALSO record the commission they now
      // owe SmartMappia (driver cash settlement, migration 0022).
      if (booking.payment_method === 'cash' && booking.payment_status !== 'verified') {
        const { error: payStatusErr } = await supabase
          .from('bookings')
          .update({ payment_status: 'verified' })
          .eq('id', booking.id);
        if (payStatusErr) console.error('cash payment_status update error:', payStatusErr);
        const { error: payRowErr } = await supabase.from('payments').insert({
          booking_id: booking.id,
          provider: 'cash',
          amount: booking.fare_amount,
          currency: booking.currency,
          status: 'verified',
          verified_by_system: true,
          verified_at: new Date().toISOString(),
          notes: 'Cash collected by driver at completion',
        });
        if (payRowErr) console.error('cash payment record error:', payRowErr);

        // Charge the platform commission to the driver's cash-owed balance.
        // Only on a freshly-written ledger row (the completed-guard above
        // already prevents re-entry, and result.skipped is a second belt).
        if (!result.skipped) {
          await chargeDriverCashOwed({
            driverId: req.driverId,
            bookingId: booking.id,
            amount: round2(result.ledger.platform_net),
          });
        }
      }
    }

    pushBookingStatus(updated.booking_code, {
      bookingStatus: updated.booking_status,
      driverRideStatus: updated.driver_ride_status,
    });
    pingAdmin(updated.booking_code);

    // Ring the passenger's bell for this lifecycle step (spec section 5).
    if (flow.notify) {
      logNotification({
        userId: booking.user_id,
        bookingId: booking.id,
        type: flow.notify,
        code: booking.booking_code,
      });
    }
    // A warm Thank You once the trip is done.
    if (status === 'completed') {
      logNotification({
        userId: booking.user_id,
        bookingId: booking.id,
        type: 'ride_thank_you',
        code: booking.booking_code,
      });
    }

    return res.json({
      bookingCode: updated.booking_code,
      driverRideStatus: updated.driver_ride_status,
      bookingStatus: updated.booking_status,
      ledger,
    });
  } catch (err) {
    console.error('updateRideStatus error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- GET /api/driver/cash ---------------------------------------------
// What this driver currently owes SmartMappia from cash pick & drop rides,
// whether they're blocked from new cash rides, and their recent movements.
async function getMyCash(req, res) {
  try {
    const { data: drv, error } = await supabase
      .from('profiles')
      .select('cash_owed, cash_owed_limit')
      .eq('id', req.driverId)
      .single();
    if (error || !drv) return res.status(404).json({ error: 'Driver not found' });

    const { data: ledger } = await supabase
      .from('driver_cash_ledger')
      .select('type, amount, balance_after, note, created_at')
      .eq('driver_id', req.driverId)
      .order('created_at', { ascending: false })
      .limit(20);

    return res.json({ ...driverCashView(drv), ledger: ledger || [] });
  } catch (err) {
    console.error('getMyCash error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- PATCH /api/driver/services ---------------------------------------
// Save which verticals this driver works (route validates: array of
// known values). Body already cleaned by validateBody; dedupe and reject
// empty here (belt-and-braces with the 0020 CHECK constraint).
async function updateServiceTypes(req, res) {
  try {
    const cleaned = [...new Set(req.body.service_types)];
    if (cleaned.length === 0) {
      return res.status(400).json({ error: 'Select at least one service type' });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ service_types: cleaned })
      .eq('id', req.driverId)
      .select('service_types')
      .single();
    if (error || !data) {
      console.error('updateServiceTypes error:', error);
      const hint = (error && error.message ? error.message : '').includes('service_types')
        ? ' Run backend/migrations/0020_driver_service_types.sql in the Supabase SQL Editor.'
        : '';
      return res.status(500).json({ error: 'Could not save your services.' + hint });
    }

    return res.json({ serviceTypes: data.service_types });
  } catch (err) {
    console.error('updateServiceTypes error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = {
  listAvailableRides,
  acceptRide,
  updateDriverLocation,
  listMyRides,
  updateRideStatus,
  getMyCash,
  updateServiceTypes,
};
