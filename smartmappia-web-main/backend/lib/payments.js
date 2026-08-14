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

// mode is a verification_mode enum value:
//   'test_auto' | 'admin_manual' | 'gateway_webhook'
//
// gateway_webhook is the card path: Tap confirmed the charge, so there is
// no human in the loop and no proof to review — the booking is verified and
// confirmed straight away, which is what starts the driver dispatch below.
// provider/gateway carry the Tap details onto the payments row.
async function verifyBookingPayment({
  booking,
  mode,
  adminId = null,
  proofId = null,
  manualReference = null,
  provider = 'stcpay_manual',
  gateway = null,
}) {
  const now = new Date().toISOString();
  // Both the test auto-verify and a gateway webhook are machine-verified;
  // only admin_manual has a human behind it.
  const verifiedBySystem = mode !== 'admin_manual';

  const { error: payErr } = await supabase.from('payments').insert({
    booking_id: booking.id,
    provider,
    // Money actually received from the passenger = fare + VAT.
    amount: payableAmount(booking),
    currency: booking.currency,
    status: 'verified',
    manual_reference: manualReference,
    verified_by_admin_id: adminId,
    verified_by_system: verifiedBySystem,
    verification_mode: mode,
    verified_at: now,
    ...(gateway
      ? {
          gateway_provider: provider,
          gateway_payment_id: gateway.paymentId,
          gateway_reference: booking.booking_code,
          gateway_status: gateway.status,
          // Redacted already by the caller — never the card object (0006).
          gateway_raw: gateway.raw || null,
        }
      : {}),
  });
  if (payErr) {
    // 23505 on uq_payments_gateway_payment_id (0006) means this charge is
    // already recorded — a replayed webhook, or the synchronous confirm and
    // the webhook racing. Both are successes, not errors.
    if (payErr.code === '23505') return { alreadyVerified: true };
    return { error: payErr };
  }

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
    eventType: mode === 'admin_manual' ? 'payment_verified' : 'auto_verified',
    title: 'Payment verified',
    message:
      mode === 'gateway_webhook'
        ? 'Your card payment went through. Your booking is confirmed.'
        : mode === 'test_auto'
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
