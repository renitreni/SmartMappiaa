// ---------------------------------------------------------------------
// Bookings controller
//   - createBooking: POST /api/bookings
//   - getBookingByCode: GET /api/bookings/:bookingCode
//
// The database fills in booking_code, payment_status, booking_status, etc.
// via its column defaults (see the SQL schema), so we only send the data
// that comes from the booking form.
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { quoteFare } = require('../lib/fare');
const { haversineKm } = require('../lib/geo');
const { addTrackingEvent } = require('../lib/tracking');
const { pushBookingStatus, announceRequestTaken } = require('../lib/realtime');
const { logNotification, notifyAdmins } = require('../lib/notifications');

// Booking states from which a passenger may still cancel (not once the trip
// is underway or already finished).
const CANCELLABLE_STATUSES = [
  'pending_payment',
  'payment_under_review',
  'confirmed',
  'driver_assigned',
  'driver_on_the_way',
  'arrived',
];

async function createBooking(req, res) {
  try {
    const b = req.body || {};

    // --- minimal validation (spec section 5 fields) ---
    const errors = [];
    if (!['house_to_airport', 'airport_to_house'].includes(b.trip_type)) {
      errors.push('trip_type must be "house_to_airport" or "airport_to_house"');
    }
    if (!b.pickup_address) errors.push('pickup_address is required');
    if (!b.dropoff_address) errors.push('dropoff_address is required');
    if (!b.pickup_datetime) errors.push('pickup_datetime is required (ISO timestamp)');
    if (!b.passenger_name) errors.push('passenger_name is required');
    if (!b.passenger_whatsapp) errors.push('passenger_whatsapp is required');
    if (b.pickup_datetime && Number.isNaN(Date.parse(b.pickup_datetime))) {
      errors.push('pickup_datetime must be a valid ISO timestamp');
    }
    const numOrNull = (v) => v == null || (typeof v === 'number' && Number.isFinite(v));
    if (![b.pickup_lat, b.pickup_lng, b.dropoff_lat, b.dropoff_lng].every(numOrNull)) {
      errors.push('coordinates must be numbers');
    }
    // Tap isn't live yet: rides are manual STC Pay or cash to the driver.
    const paymentMethod = b.payment_method ?? 'stcpay_manual';
    if (!['stcpay_manual', 'cash'].includes(paymentMethod)) {
      errors.push('payment_method must be "stcpay_manual" or "cash"');
    }
    if (errors.length) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    const isCash = paymentMethod === 'cash';

    // --- fare snapshot (computed once, never recalculated) ---
    // `amount` is the EX-VAT fare and stays the driver-commission base
    // (lib/ledger.js); VAT and the distance surcharge ride alongside it and
    // totalAmount is what the passenger actually pays. See migrations 0025
    // and 0034.
    //
    // Distance is straight-line pickup -> dropoff. Both ends are nullable,
    // and haversineKm returns null if either is missing — which quoteFare
    // reads as "no surcharge" rather than guessing. Rides have no distance
    // cap: a long airport transfer is legitimate.
    const distanceKm = haversineKm(
      { lat: b.pickup_lat, lng: b.pickup_lng },
      { lat: b.dropoff_lat, lng: b.dropoff_lng }
    );
    const { amount, currency, vatAmount, vatRate, totalAmount, distanceSurcharge } = quoteFare({
      routeType: b.route_type,
      distanceKm,
    });

    // --- insert the booking (tied to the signed-in passenger) ---
    const { data: booking, error } = await supabase
      .from('bookings')
      .insert({
        user_id: req.userId,
        trip_type: b.trip_type,
        airport_terminal: b.airport_terminal ?? null,
        pickup_address: b.pickup_address,
        pickup_lat: b.pickup_lat ?? null,
        pickup_lng: b.pickup_lng ?? null,
        dropoff_address: b.dropoff_address,
        dropoff_lat: b.dropoff_lat ?? null,
        dropoff_lng: b.dropoff_lng ?? null,
        pickup_datetime: b.pickup_datetime,
        passenger_count: b.passenger_count ?? 1,
        luggage_count: b.luggage_count ?? 0,
        notes: b.notes ?? null,
        passenger_name: b.passenger_name,
        passenger_mobile: b.passenger_mobile ?? null,
        passenger_whatsapp: b.passenger_whatsapp,
        passenger_email: b.passenger_email ?? null,
        fare_amount: amount,
        distance_km: distanceKm != null ? Math.round(distanceKm * 100) / 100 : null,
        distance_surcharge: distanceSurcharge,
        vat_amount: vatAmount,
        vat_rate: vatRate,
        total_amount: totalAmount,
        currency,
        payment_method: paymentMethod,
        // Cash needs no proof upload: the booking is confirmed right away
        // and the driver collects the fare at pickup. payment_status stays
        // at its 'awaiting_proof' default until the ride completes, so
        // revenue stats (which count 'verified') stay honest.
        ...(isCash ? { booking_status: 'confirmed' } : {}),
        // booking_code, payment_status (and booking_status for STC Pay)
        // come from database defaults.
      })
      .select(
        'id, booking_code, fare_amount, vat_amount, vat_rate, total_amount, currency, ' +
          'booking_status, payment_status, payment_method'
      )
      .single();

    if (error) {
      console.error('createBooking insert error:', error);
      return res.status(500).json({ error: 'Could not create booking' });
    }

    // --- start the tracking timeline (spec section 7) ---
    await supabase.from('tracking_events').insert({
      booking_id: booking.id,
      event_type: 'booking_created',
      title: isCash ? 'Booking confirmed' : 'Booking created',
      message: isCash
        ? 'Your booking is confirmed. Pay the driver in cash at pickup.'
        : 'Your booking has been created. Please continue to payment.',
    });

    await Promise.all([
      logNotification({
        userId: req.userId,
        bookingId: booking.id,
        type: 'ride_booking_confirmed',
        code: booking.booking_code,
        title: isCash ? 'Ride booking confirmed' : 'Ride booking created',
        body: isCash
          ? 'Booking confirmed — pay your driver in cash at pickup.'
          : 'Complete payment so Smart Mappia can find your driver.',
        url: isCash ? `/track/${booking.booking_code}` : `/pay/${booking.booking_code}`,
      }),
      notifyAdmins({
        bookingId: booking.id,
        type: 'ride_booking_created',
        code: booking.booking_code,
        url: '/admin',
      }),
    ]);

    // Cash bookings are already confirmed — find a driver right away
    // (STC Pay bookings dispatch after the payment is verified).
    if (isCash) {
      // Lazy require: dispatch depends on realtime/geo (see lib/payments.js).
      const { startRideDispatch } = require('../lib/dispatch');
      startRideDispatch(booking.id);
    }

    // We expose booking_code (public), never the internal id.
    return res.status(201).json({
      bookingCode: booking.booking_code,
      fareAmount: booking.fare_amount,
      vatAmount: booking.vat_amount,
      vatRate: booking.vat_rate,
      // What the passenger actually pays (fare + VAT).
      totalAmount: booking.total_amount,
      currency: booking.currency,
      bookingStatus: booking.booking_status,
      paymentStatus: booking.payment_status,
      paymentMethod: booking.payment_method,
      next: isCash
        ? `/track/${booking.booking_code}`
        : `/booking/payment/stcpay/${booking.booking_code}`,
    });
  } catch (err) {
    console.error('createBooking error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// GET /api/bookings -> the signed-in passenger's own booking history.
// Powers the Transaction Records hub (spec section 6). Scoped to req.userId
// so a passenger only ever sees their own trips.
async function listMyBookings(req, res) {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select(
        'booking_code, trip_type, airport_terminal, pickup_address, dropoff_address, ' +
          'pickup_datetime, fare_amount, vat_amount, vat_rate, total_amount, currency, ' +
          'payment_status, payment_method, booking_status, driver_ride_status, created_at'
      )
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      console.error('listMyBookings error:', error);
      return res.status(500).json({ error: 'Could not load your bookings' });
    }
    return res.json({ bookings: data || [] });
  } catch (err) {
    console.error('listMyBookings error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function getBookingByCode(req, res) {
  try {
    const { bookingCode } = req.params;
    const { data, error } = await supabase
      .from('bookings')
      .select(
        'booking_code, trip_type, airport_terminal, pickup_address, dropoff_address, ' +
          'pickup_datetime, fare_amount, vat_amount, vat_rate, total_amount, currency, ' +
          'payment_status, booking_status'
      )
      .eq('booking_code', bookingCode)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    return res.json(data);
  } catch (err) {
    console.error('getBookingByCode error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// POST /api/bookings/:bookingCode/cancel  -> passenger cancels the trip
async function cancelBooking(req, res) {
  try {
    const { bookingCode } = req.params;
    const reason = (req.body && req.body.reason) || null;

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, booking_code, booking_status, assigned_driver_id, user_id')
      .eq('booking_code', bookingCode)
      .single();
    if (error || !booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    // Only the owner (or an admin) may cancel.
    if (booking.user_id && req.userId !== booking.user_id && req.role !== 'admin') {
      return res.status(403).json({ error: 'You can only cancel your own booking' });
    }
    if (booking.booking_status === 'cancelled') {
      return res.status(409).json({ error: 'Booking is already cancelled' });
    }
    if (!CANCELLABLE_STATUSES.includes(booking.booking_status)) {
      return res.status(409).json({
        error: `Booking can no longer be cancelled (status: ${booking.booking_status})`,
      });
    }

    const wasAvailable = booking.booking_status === 'confirmed' && !booking.assigned_driver_id;

    const { data: updated, error: updErr } = await supabase
      .from('bookings')
      .update({
        booking_status: 'cancelled',
        driver_ride_status: booking.assigned_driver_id ? 'cancelled' : null,
      })
      .eq('id', booking.id)
      .select('booking_code, booking_status')
      .single();
    if (updErr) {
      console.error('cancel booking update error:', updErr);
      return res.status(500).json({ error: 'Unexpected server error' });
    }

    await addTrackingEvent(booking.id, {
      eventType: 'booking_cancelled',
      title: 'Booking cancelled',
      message: reason
        ? `The passenger cancelled this booking: ${reason}.`
        : 'The passenger cancelled this booking.',
    });

    pushBookingStatus(booking.booking_code, { bookingStatus: 'cancelled' });
    // If it was in the open feed (or claimed), pull it from drivers' lists.
    announceRequestTaken(booking.booking_code);

    return res.json({
      bookingCode: updated.booking_code,
      bookingStatus: updated.booking_status,
    });
  } catch (err) {
    console.error('cancelBooking error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// PATCH /api/bookings/:bookingCode/contact  -> owner edits their contact
// number(s) while the trip is still active (even mid-delivery), so the
// driver/admin always reach the right number. Broadcast refreshes both views.
const CONTACT_EDITABLE_STATUSES = [...CANCELLABLE_STATUSES, 'in_progress'];

async function updateBookingContact(req, res) {
  try {
    const { bookingCode } = req.params;
    const b = req.body; // validated by the route schema

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, booking_code, booking_status, user_id')
      .eq('booking_code', bookingCode)
      .single();
    if (error || !booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.user_id && req.userId !== booking.user_id && req.role !== 'admin') {
      return res.status(403).json({ error: 'You can only edit your own booking' });
    }
    if (!CONTACT_EDITABLE_STATUSES.includes(booking.booking_status)) {
      return res.status(409).json({
        error: `The contact number can no longer be changed (status: ${booking.booking_status})`,
      });
    }

    const patch = {};
    if ('passenger_mobile' in b) patch.passenger_mobile = b.passenger_mobile || null;
    if ('passenger_whatsapp' in b && b.passenger_whatsapp) patch.passenger_whatsapp = b.passenger_whatsapp;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const { data: updated, error: updErr } = await supabase
      .from('bookings')
      .update(patch)
      .eq('id', booking.id)
      .select('booking_code, passenger_mobile, passenger_whatsapp')
      .single();
    if (updErr) {
      console.error('updateBookingContact error:', updErr);
      return res.status(500).json({ error: 'Could not update the contact number' });
    }

    await addTrackingEvent(booking.id, {
      eventType: 'contact_updated',
      title: 'Contact number updated',
      message: 'The passenger updated their contact number.',
    });
    // Driver + admin views refresh over the same channels they already watch.
    pushBookingStatus(booking.booking_code, {
      contact: { mobile: updated.passenger_mobile, whatsapp: updated.passenger_whatsapp },
    });
    const { pingAdmin } = require('../lib/realtime');
    pingAdmin(booking.booking_code);

    return res.json({
      bookingCode: updated.booking_code,
      passengerMobile: updated.passenger_mobile,
      passengerWhatsapp: updated.passenger_whatsapp,
    });
  } catch (err) {
    console.error('updateBookingContact error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { createBooking, listMyBookings, getBookingByCode, cancelBooking, updateBookingContact };
