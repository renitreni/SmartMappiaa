// ---------------------------------------------------------------------
// Payment verification state machine (spec §9).
//
// Both paths converge here so the status transitions are defined ONCE:
//   - test auto-verify (proof upload, AUTO_VERIFY_STCPAY_TEST_MODE=true)
//   - admin manual verify / reject
//
// NOTE: Supabase's JS client has no multi-table transaction. We write the
// payments row, the proof, then the booking in sequence and bail on the
// first error. For the MVP volume this is acceptable; a Postgres function
// (RPC) is the upgrade path if atomicity becomes critical.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { addTrackingEvent } = require('./tracking');
const { pushBookingStatus, pingAdmin } = require('./realtime');
const { payableAmount } = require('./fare');

// mode is a verification_mode enum value: 'test_auto' | 'admin_manual'.
async function verifyBookingPayment({ booking, mode, adminId = null, proofId = null, manualReference = null }) {
  const now = new Date().toISOString();
  const verifiedBySystem = mode === 'test_auto';

  const { error: payErr } = await supabase.from('payments').insert({
    booking_id: booking.id,
    provider: 'stcpay_manual',
    // Money actually received from the passenger = fare + VAT.
    amount: payableAmount(booking),
    currency: booking.currency,
    status: 'verified',
    manual_reference: manualReference,
    verified_by_admin_id: adminId,
    verified_by_system: verifiedBySystem,
    verification_mode: mode,
    verified_at: now,
  });
  if (payErr) return { error: payErr };

  if (proofId) {
    const { error: proofErr } = await supabase
      .from('payment_proofs')
      .update({
        status: 'verified',
        verification_mode: mode,
        admin_reviewer_id: adminId,
        reviewed_at: now,
        test_auto_verified_at: verifiedBySystem ? now : null,
      })
      .eq('id', proofId);
    if (proofErr) return { error: proofErr };
  }

  const { data: updated, error: bookErr } = await supabase
    .from('bookings')
    .update({
      payment_status: 'verified',
      booking_status: 'confirmed',
      verification_mode: mode,
      confirmed_at: now,
      test_auto_verified_at: verifiedBySystem ? now : null,
    })
    .eq('id', booking.id)
    .select('booking_code, payment_status, booking_status, verification_mode, confirmed_at')
    .single();
  if (bookErr) return { error: bookErr };

  await addTrackingEvent(booking.id, {
    eventType: verifiedBySystem ? 'auto_verified' : 'payment_verified',
    title: 'Payment verified',
    message: verifiedBySystem
      ? 'Your payment was auto-verified (test mode). Your booking is confirmed.'
      : 'Your payment has been verified. Your booking is confirmed.',
    createdByUserId: adminId,
  });

  // Realtime: confirm to the passenger, then dispatch Grab-style — the
  // nearest online driver gets an exclusive 30s offer (lib/dispatch.js);
  // the old broadcast-to-all feed is the fallback when nobody is online.
  pushBookingStatus(booking.booking_code, {
    paymentStatus: 'verified',
    bookingStatus: 'confirmed',
  });
  // Lazy require: dispatch depends on realtime/geo and payments is loaded early.
  const { startRideDispatch } = require('./dispatch');
  startRideDispatch(booking.id);

  return { booking: updated };
}

async function rejectBookingPayment({ booking, adminId = null, reason = null, proofId = null }) {
  const now = new Date().toISOString();

  if (proofId) {
    const { error: proofErr } = await supabase
      .from('payment_proofs')
      .update({
        status: 'rejected',
        admin_reviewer_id: adminId,
        reviewed_at: now,
        rejection_reason: reason,
      })
      .eq('id', proofId);
    if (proofErr) return { error: proofErr };
  }

  const { data: updated, error: bookErr } = await supabase
    .from('bookings')
    .update({
      payment_status: 'rejected',
      booking_status: 'pending_payment',
    })
    .eq('id', booking.id)
    .select('booking_code, payment_status, booking_status')
    .single();
  if (bookErr) return { error: bookErr };

  await addTrackingEvent(booking.id, {
    eventType: 'payment_rejected',
    title: 'Payment rejected',
    message: reason
      ? `Your payment proof was rejected: ${reason}. Please upload a valid proof.`
      : 'Your payment proof was rejected. Please upload a valid proof.',
    createdByUserId: adminId,
  });

  // Realtime: tell the passenger to re-upload; refresh the admin board.
  pushBookingStatus(booking.booking_code, {
    paymentStatus: 'rejected',
    bookingStatus: 'pending_payment',
  });
  pingAdmin(booking.booking_code);

  return { booking: updated };
}

module.exports = { verifyBookingPayment, rejectBookingPayment };
