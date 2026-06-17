// ---------------------------------------------------------------------
// Admin controller (all routes gated by requireAdmin)
//   - listBookings    : GET  /api/admin/bookings
//   - getBookingDetail: GET  /api/admin/bookings/:bookingCode
//   - verifyPayment   : POST /api/admin/bookings/:bookingCode/verify-payment
//   - rejectPayment   : POST /api/admin/bookings/:bookingCode/reject-payment
//   - assignDriver    : POST /api/admin/bookings/:bookingCode/assign-driver
//
// Verify/reject reuse lib/payments.js so manual review and test auto-verify
// share one state machine. The admin's profile id is optional (interim
// shared-secret auth has no user context) and passed via x-admin-id.
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { addTrackingEvent } = require('../lib/tracking');
const { verifyBookingPayment, rejectBookingPayment } = require('../lib/payments');
const { createProofDownloadUrl } = require('../lib/storage');
const { pushBookingStatus, announceRequestTaken } = require('../lib/realtime');

function adminId(req) {
  return req.adminId || null;
}

// --- GET /api/admin/stats --------------------------------------------
// Dashboard overview: totals, revenue, status breakdowns, driver counts.
// For the MVP we read slim columns and aggregate in JS; swap to SQL
// aggregates if the bookings table ever gets large.
const ACTIVE_BOOKING = ['driver_assigned', 'driver_on_the_way', 'arrived', 'in_progress'];

async function getStats(req, res) {
  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('booking_status, payment_status, fare_amount, created_at');
    if (error) return res.status(500).json({ error: error.message });

    const { data: drivers, error: dErr } = await supabase
      .from('profiles')
      .select('driver_approved')
      .eq('role', 'driver');
    if (dErr) return res.status(500).json({ error: dErr.message });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const bookingsByStatus = {};
    const paymentsByStatus = {};
    let revenue = 0;
    let completed = 0;
    let cancelled = 0;
    let active = 0;
    let today = 0;

    for (const b of bookings || []) {
      bookingsByStatus[b.booking_status] = (bookingsByStatus[b.booking_status] || 0) + 1;
      paymentsByStatus[b.payment_status] = (paymentsByStatus[b.payment_status] || 0) + 1;
      if (b.payment_status === 'verified') revenue += Number(b.fare_amount) || 0;
      if (b.booking_status === 'completed') completed += 1;
      if (b.booking_status === 'cancelled') cancelled += 1;
      if (ACTIVE_BOOKING.includes(b.booking_status)) active += 1;
      if (b.created_at && new Date(b.created_at) >= startOfToday) today += 1;
    }

    const totalDrivers = (drivers || []).length;
    const approvedDrivers = (drivers || []).filter((d) => d.driver_approved).length;

    return res.json({
      totals: {
        bookings: (bookings || []).length,
        completed,
        cancelled,
        active,
        today,
        revenue: Math.round(revenue * 100) / 100,
        currency: 'SAR',
        needsReview: paymentsByStatus.proof_uploaded || 0,
        awaitingPayment: paymentsByStatus.awaiting_proof || 0,
      },
      drivers: {
        total: totalDrivers,
        approved: approvedDrivers,
        pending: totalDrivers - approvedDrivers,
      },
      bookingsByStatus,
      paymentsByStatus,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('getStats error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- GET /api/admin/drivers ------------------------------------------
async function listDrivers(req, res) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, whatsapp_number, mobile_number, national_id, vehicle_type, vehicle_plate, driver_approved, created_at')
      .eq('role', 'driver')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ drivers: data });
  } catch (err) {
    console.error('listDrivers error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- POST /api/admin/drivers/:driverId/approval ----------------------
async function setDriverApproval(req, res) {
  try {
    const approved = req.body && req.body.approved !== false; // default true
    const { data, error } = await supabase
      .from('profiles')
      .update({ driver_approved: approved })
      .eq('id', req.params.driverId)
      .eq('role', 'driver')
      .select('id, full_name, driver_approved')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Driver not found' });
    return res.json({ id: data.id, fullName: data.full_name, driverApproved: data.driver_approved });
  } catch (err) {
    console.error('setDriverApproval error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function loadBooking(bookingCode) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, booking_code, fare_amount, currency, payment_status, booking_status, assigned_driver_id')
    .eq('booking_code', bookingCode)
    .single();
  if (error || !data) return null;
  return data;
}

// Latest proof id for a booking (the one under review), or null.
async function latestProofId(bookingId) {
  const { data } = await supabase
    .from('payment_proofs')
    .select('id')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? data.id : null;
}

// --- GET /api/admin/bookings -----------------------------------------
async function listBookings(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let query = supabase
      .from('bookings')
      .select(
        'booking_code, passenger_name, passenger_whatsapp, trip_type, pickup_datetime, ' +
          'fare_amount, currency, payment_status, booking_status, driver_ride_status, ' +
          'assigned_driver_id, created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.booking_status) query = query.eq('booking_status', req.query.booking_status);
    if (req.query.payment_status) query = query.eq('payment_status', req.query.payment_status);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ total: count ?? data.length, limit, offset, bookings: data });
  } catch (err) {
    console.error('listBookings error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- GET /api/admin/bookings/:bookingCode ----------------------------
async function getBookingDetail(req, res) {
  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('booking_code', req.params.bookingCode)
      .single();
    if (error || !booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const { data: proofs } = await supabase
      .from('payment_proofs')
      .select('id, file_url, file_name, file_mime_type, file_size_bytes, status, rejection_reason, reviewed_at, created_at')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: false });

    // Attach a short-lived signed download URL to each proof so the admin
    // can view the private file. Best-effort per proof.
    const proofsWithUrls = await Promise.all(
      (proofs || []).map(async (p) => {
        let downloadUrl = null;
        try {
          downloadUrl = await createProofDownloadUrl(p.file_url);
        } catch (e) {
          console.error('proof signed url error:', e);
        }
        return { ...p, downloadUrl };
      })
    );

    const { data: payments } = await supabase
      .from('payments')
      .select('id, provider, amount, currency, status, manual_reference, verified_by_system, verification_mode, verified_at, created_at')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: false });

    return res.json({ booking, proofs: proofsWithUrls, payments: payments || [] });
  } catch (err) {
    console.error('getBookingDetail error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- POST /api/admin/bookings/:bookingCode/verify-payment ------------
async function verifyPayment(req, res) {
  try {
    const booking = await loadBooking(req.params.bookingCode);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.payment_status === 'verified') {
      return res.status(409).json({ error: 'Payment already verified' });
    }

    const proofId = await latestProofId(booking.id);
    const { booking: updated, error } = await verifyBookingPayment({
      booking,
      mode: 'admin_manual',
      adminId: adminId(req),
      proofId,
      manualReference: (req.body && req.body.manual_reference) || null,
    });
    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      bookingCode: updated.booking_code,
      paymentStatus: updated.payment_status,
      bookingStatus: updated.booking_status,
    });
  } catch (err) {
    console.error('verifyPayment error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- POST /api/admin/bookings/:bookingCode/reject-payment ------------
async function rejectPayment(req, res) {
  try {
    const reason = (req.body && req.body.reason) || null;
    if (!reason) {
      return res.status(400).json({ error: 'reason is required to reject a payment' });
    }

    const booking = await loadBooking(req.params.bookingCode);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.payment_status === 'verified') {
      return res.status(409).json({ error: 'Payment already verified; cannot reject' });
    }

    const proofId = await latestProofId(booking.id);
    const { booking: updated, error } = await rejectBookingPayment({
      booking,
      adminId: adminId(req),
      reason,
      proofId,
    });
    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      bookingCode: updated.booking_code,
      paymentStatus: updated.payment_status,
      bookingStatus: updated.booking_status,
    });
  } catch (err) {
    console.error('rejectPayment error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- POST /api/admin/bookings/:bookingCode/assign-driver -------------
async function assignDriver(req, res) {
  try {
    const driverId = req.body && req.body.driver_id;
    if (!driverId) {
      return res.status(400).json({ error: 'driver_id is required' });
    }

    const booking = await loadBooking(req.params.bookingCode);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.payment_status !== 'verified') {
      return res.status(409).json({ error: 'Cannot assign a driver before payment is verified' });
    }

    // Confirm the target is a real driver profile.
    const { data: driver, error: driverErr } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', driverId)
      .single();
    if (driverErr || !driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }
    if (driver.role !== 'driver') {
      return res.status(400).json({ error: 'Target profile is not a driver' });
    }

    const { data: updated, error } = await supabase
      .from('bookings')
      .update({
        assigned_driver_id: driver.id,
        driver_ride_status: 'assigned',
        booking_status: 'driver_assigned',
      })
      .eq('id', booking.id)
      .select('booking_code, booking_status, driver_ride_status')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await addTrackingEvent(booking.id, {
      eventType: 'driver_assigned',
      title: 'Driver assigned',
      message: `${driver.full_name || 'Your driver'} has been assigned to your trip.`,
      createdByUserId: adminId(req),
    });

    // Realtime: tell the passenger, and pull the ride from the open feed.
    pushBookingStatus(updated.booking_code, {
      bookingStatus: 'driver_assigned',
      driverRideStatus: 'assigned',
      driver: { name: driver.full_name, whatsapp: null },
    });
    announceRequestTaken(updated.booking_code);

    return res.json({
      bookingCode: updated.booking_code,
      bookingStatus: updated.booking_status,
      driverRideStatus: updated.driver_ride_status,
    });
  } catch (err) {
    console.error('assignDriver error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = {
  getStats,
  listBookings,
  getBookingDetail,
  verifyPayment,
  rejectPayment,
  assignDriver,
  listDrivers,
  setDriverApproval,
};
