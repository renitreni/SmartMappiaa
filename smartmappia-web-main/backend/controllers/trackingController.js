// ---------------------------------------------------------------------
// Tracking controller
//   - getTracking : GET /api/tracking/:bookingCode
//
// Drives the Grab-style tracking page (spec §7): current status, ETA text,
// assigned driver contact, and the full timeline. Keyed ONLY by the public
// booking code; internal UUIDs are never returned (spec §15).
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { haversineKm, etaMinutes } = require('../lib/geo');

// Ride states where showing a live driver position makes sense.
const ACTIVE_RIDE_STATUSES = ['accepted', 'on_the_way', 'arrived', 'started'];

async function getTracking(req, res) {
  try {
    const { bookingCode } = req.params;

    // Fetch the booking (incl. internal ids we use server-side but never return).
    const { data: booking, error } = await supabase
      .from('bookings')
      .select(
        'id, assigned_driver_id, booking_code, trip_type, airport_terminal, ' +
          'pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, ' +
          'pickup_datetime, fare_amount, currency, ' +
          'payment_status, booking_status, verification_mode, driver_ride_status, ' +
          'confirmed_at, created_at'
      )
      .eq('booking_code', bookingCode)
      .single();

    if (error || !booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Timeline events, oldest first.
    const { data: events, error: eventsErr } = await supabase
      .from('tracking_events')
      .select('event_type, title, message, created_at')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: true });
    if (eventsErr) {
      console.error('tracking events query error:', eventsErr);
      return res.status(500).json({ error: 'Unexpected server error' });
    }

    // Assigned driver contact (safe fields only) + latest live position.
    let driver = null;
    let driverLocation = null;
    let liveEtaMinutes = null;
    if (booking.assigned_driver_id) {
      const { data: d } = await supabase
        .from('profiles')
        .select('full_name, whatsapp_number')
        .eq('id', booking.assigned_driver_id)
        .single();
      if (d) {
        driver = { name: d.full_name, whatsapp: d.whatsapp_number };
      }

      // Only surface a live dot while the ride is actually active.
      if (ACTIVE_RIDE_STATUSES.includes(booking.driver_ride_status)) {
        const { data: loc } = await supabase
          .from('driver_locations')
          .select('lat, lng, recorded_at')
          .eq('driver_id', booking.assigned_driver_id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (loc) {
          driverLocation = { lat: loc.lat, lng: loc.lng, at: loc.recorded_at };
          const distanceKm = haversineKm(
            { lat: loc.lat, lng: loc.lng },
            { lat: booking.pickup_lat, lng: booking.pickup_lng }
          );
          liveEtaMinutes = etaMinutes(distanceKm);
        }
      }
    }

    return res.json({
      bookingCode: booking.booking_code,
      tripType: booking.trip_type,
      airportTerminal: booking.airport_terminal,
      pickupAddress: booking.pickup_address,
      pickupLat: booking.pickup_lat,
      pickupLng: booking.pickup_lng,
      dropoffAddress: booking.dropoff_address,
      dropoffLat: booking.dropoff_lat,
      dropoffLng: booking.dropoff_lng,
      pickupDatetime: booking.pickup_datetime,
      fareAmount: booking.fare_amount,
      currency: booking.currency,
      paymentStatus: booking.payment_status,
      bookingStatus: booking.booking_status,
      verificationMode: booking.verification_mode,
      driverRideStatus: booking.driver_ride_status,
      // ETAs are derived automatically from live data (no hand-filled columns):
      //   - scheduledPickup      : the booking's scheduled pickup time
      //   - paymentConfirmation  : when payment was confirmed (null until verified)
      //   - driverArrivalMinutes : live estimate from the driver's latest GPS to
      //                            the pickup point (null until a driver is active)
      etas: {
        scheduledPickup: booking.pickup_datetime,
        paymentConfirmation: booking.confirmed_at,
        driverArrivalMinutes: liveEtaMinutes,
      },
      driver,
      driverLocation,
      liveEtaMinutes,
      createdAt: booking.created_at,
      timeline: (events || []).map((e) => ({
        type: e.event_type,
        title: e.title,
        message: e.message,
        at: e.created_at,
      })),
    });
  } catch (err) {
    console.error('getTracking error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { getTracking };
