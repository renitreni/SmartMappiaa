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
const { addTrackingEvent } = require('../lib/tracking');
const { pushBookingStatus, announceRequestTaken } = require('../lib/realtime');

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
    if (errors.length) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    // --- fare snapshot (computed once, never recalculated) ---
    const { amount, currency } = quoteFare({ routeType: b.route_type });

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
        currency,
        // booking_code, payment_method, payment_status, booking_status
        // all come from database defaults.
      })
      .select(
        'id, booking_code, fare_amount, currency, booking_status, payment_status, payment_method'
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
      title: 'Booking created',
      message: 'Your booking has been created. Please continue to payment.',
    });

    // We expose booking_code (public), never the internal id.
    return res.status(201).json({
      bookingCode: booking.booking_code,
      fareAmount: booking.fare_amount,
      currency: booking.currency,
      bookingStatus: booking.booking_status,
      paymentStatus: booking.payment_status,
      paymentMethod: booking.payment_method,
      next: `/booking/payment/stcpay/${booking.booking_code}`,
    });
  } catch (err) {
    console.error('createBooking error:', err);
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
          'pickup_datetime, fare_amount, currency, payment_status, booking_status'
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

module.exports = { createBooking, getBookingByCode, cancelBooking };
