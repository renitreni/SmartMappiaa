// ---------------------------------------------------------------------
// Card payments — the Tap webhook (all three verticals) and the rides
// charge endpoint.
//
//   - tapWebhook               : POST /api/payments/webhooks/tap
//   - createBookingCardCharge  : POST /api/payments/bookings/:code/charge
//
// The webhook is the platform's single source of truth for card payments.
// It replaced two per-vertical copies whose signature check could never
// have matched a real Tap webhook (they HMAC'd JSON.stringify(body); Tap
// signs a concatenation of named fields — see lib/tap.js).
// ---------------------------------------------------------------------
const crypto = require('crypto');

const { supabase } = require('../lib/supabase');
const tap = require('../lib/tap');
const savedCards = require('../lib/savedCards');
const { chargeForOrder, respondToCharge } = require('../lib/cardCharge');
const { confirmGatewayPayment, isKnownVertical } = require('../lib/gatewayPaid');

// Ride bookings the passenger may still pay for.
const PAYABLE_BOOKING_STATUSES = ['awaiting_proof', 'proof_uploaded', 'under_review', 'rejected'];

// Keep the audit trail useful without persisting card references. Anything
// not named here is dropped — in particular `card` and `source`, which
// carry the masked PAN and the saved card id.
function redactWebhookPayload(body) {
  const b = body || {};
  return {
    id: b.id || null,
    status: b.status || null,
    amount: b.amount ?? null,
    currency: b.currency || null,
    reference: b.reference || null,
    metadata: b.metadata || null,
    created: (b.transaction && b.transaction.created) || null,
  };
}

// Our own charges always carry metadata.vertical. The code prefix is the
// fallback, matching how driverDispatchController resolves the same thing.
function resolveVertical(charge) {
  const fromMetadata = charge && charge.metadata && charge.metadata.vertical;
  if (isKnownVertical(fromMetadata)) return fromMetadata;
  const code = String((charge && charge.reference && charge.reference.order) || '').toUpperCase();
  if (code.startsWith('FD-')) return 'food';
  if (code.startsWith('SH-')) return 'shop';
  return 'ride';
}

async function recordWebhookEvent({ body, signatureVerified }) {
  const { data } = await supabase
    .from('webhook_events')
    .insert({
      provider: 'tap',
      event_type: (body && body.status) || null,
      gateway_payment_id: (body && body.id) || null,
      signature_verified: signatureVerified,
      payload: redactWebhookPayload(body),
      // Duplicate detection and reconciliation forensics only — NOT an
      // authentication control (that is the hashstring, above).
      payload_sha256: crypto
        .createHash('sha256')
        .update(JSON.stringify(body || {}))
        .digest('hex'),
    })
    .select('id')
    .single();
  return data ? data.id : null;
}

async function finishWebhookEvent(eventId, patch) {
  if (!eventId) return;
  await supabase
    .from('webhook_events')
    .update({ ...patch, processed_at: new Date().toISOString() })
    .eq('id', eventId);
}

async function tapWebhook(req, res) {
  let eventId = null;
  try {
    // 1. Fail closed. With no key configured no legitimate Tap webhook can
    //    exist, so an unsigned "CAPTURED" must never be trusted — otherwise
    //    a POST with a guessed order code marks that order paid for free.
    if (!tap.tapConfigured()) {
      return res.status(503).json({ error: 'Card payment is not configured' });
    }

    const body = req.body || {};

    // 2. Verify Tap's hashstring: HMAC-SHA256 over the x_id/x_amount/...
    //    field concatenation, keyed with the secret API key, compared in
    //    constant time.
    const signatureVerified = tap.verifyWebhookHash(body, req.get('hashstring'));

    // 3. Log the attempt either way. A run of signature_verified = false
    //    rows is the only signal we would ever get that someone is probing
    //    this endpoint.
    eventId = await recordWebhookEvent({ body, signatureVerified });
    if (!signatureVerified) {
      await finishWebhookEvent(eventId, { verified_by_fetch: false });
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const chargeId = body.id;
    const code = body.reference && body.reference.order;
    if (!chargeId || !code) {
      await finishWebhookEvent(eventId, { verified_by_fetch: false });
      return res.status(400).json({ error: 'Malformed webhook' });
    }

    // 4. Verify by fetch. The hash proves the message came from Tap; only
    //    Tap's own record of the charge proves what actually happened, so
    //    the posted status and amount are never acted on directly.
    let charge;
    try {
      charge = await tap.fetchCharge(chargeId);
    } catch (err) {
      // Tap retries on a non-2xx, and a transient fetch failure is exactly
      // the case where a retry helps.
      await finishWebhookEvent(eventId, { verified_by_fetch: false });
      return res.status(502).json({ error: 'Could not verify the charge' });
    }

    const status = String(charge.status || '').toUpperCase();
    const vertical = resolveVertical(charge);

    if (status !== 'CAPTURED') {
      // Not a payment. Mark the order failed so the customer is told to try
      // again, but only from the awaiting state — never walk back a paid
      // order because a later event arrived out of order.
      if (['FAILED', 'DECLINED', 'CANCELLED', 'ABANDONED'].includes(status)) {
        await markFailed(vertical, code);
      }
      await finishWebhookEvent(eventId, { verified_by_fetch: true, event_type: status });
      return res.json({ received: true, ignored: status });
    }

    // 5. Money moved -> the order is confirmed. No admin review on this
    //    path: Tap already told us, and re-checking by hand adds delay
    //    without adding certainty.
    const result = await confirmGatewayPayment({
      vertical,
      code,
      chargeId: charge.id,
      status,
      amountPaid: charge.amount,
      currency: charge.currency,
    });

    if (!result.ok) {
      console.error('tapWebhook: refused to confirm', {
        vertical,
        code,
        chargeId: charge.id,
        reason: result.reason,
        expected: result.expected,
        amountPaid: result.amountPaid,
      });
      await finishWebhookEvent(eventId, { verified_by_fetch: false });
      // Still 200: retrying an event we have correctly decided to reject
      // achieves nothing but six more deliveries over three hours.
      return res.json({ received: true, ignored: result.reason });
    }

    // 6. If the charge carried save_card, persist the references Tap minted.
    //    This is the only place guaranteed to observe a completed 3DS
    //    charge — the synchronous response for one is INITIATED and carries
    //    no card id, and the customer may never return to the redirect URL.
    //    userId comes from the ORDER, never from webhook metadata.
    const ownerId = result.record && (result.record.customer_id || null);
    if (ownerId) {
      try {
        await savedCards.saveMethodFromCharge({
          userId: ownerId,
          charge,
          consentReference: code,
        });
      } catch (err) {
        // A failure to remember the card must not un-pay the order.
        console.error('tapWebhook: could not save payment method', { code, error: err.message });
      }
    }

    await finishWebhookEvent(eventId, {
      verified_by_fetch: true,
      ...(vertical === 'ride' ? { booking_id: result.record.id } : {}),
      ...(vertical === 'food' ? { order_id: result.record.id } : {}),
      ...(vertical === 'shop' ? { shop_order_id: result.record.id } : {}),
    });
    return res.json({ received: true });
  } catch (err) {
    console.error('tapWebhook error:', err);
    await finishWebhookEvent(eventId, { verified_by_fetch: false });
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// A failed charge leaves the order payable so the customer can retry. It is
// never walked back from a settled state.
async function markFailed(vertical, code) {
  if (vertical === 'ride') {
    await supabase
      .from('bookings')
      .update({ payment_status: 'rejected' })
      .eq('booking_code', code)
      .in('payment_status', ['awaiting_proof', 'proof_uploaded', 'under_review']);
    return;
  }
  const table = vertical === 'shop' ? 'shop_orders' : 'orders';
  await supabase
    .from(table)
    .update({ payment_status: 'failed' })
    .eq('order_code', code)
    .eq('payment_status', 'awaiting');
}

// --- Rides: start a card charge --------------------------------------
//
// This endpoint is new. The frontend has been calling
// POST /api/payments/:code/tap-charge since the Tap work began, but no such
// route was ever mounted in app.js — it 404s, hidden only by the
// VITE_TAP_ENABLED flag on the button.
async function createBookingCardCharge(req, res) {
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select(
        'id, booking_code, customer_id, fare_amount, vat_amount, total_amount, currency, ' +
          'payment_method, payment_status'
      )
      .eq('booking_code', req.params.code)
      .maybeSingle();

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // No admin bypass on a card charge, unlike the proof endpoints: an
    // admin acting on a passenger's booking must not be able to attach or
    // charge that passenger's card.
    if (booking.customer_id !== req.userId) {
      return res.status(403).json({ error: 'This booking belongs to another account' });
    }
    if (booking.payment_method === 'cash') {
      return res.status(409).json({ error: 'This booking is cash on delivery — no online payment is needed' });
    }
    if (!PAYABLE_BOOKING_STATUSES.includes(booking.payment_status)) {
      return res.status(409).json({ error: `Payment is already ${booking.payment_status}` });
    }

    const { payableAmount } = require('../lib/fare');
    const result = await chargeForOrder({
      req,
      profile: req.profile,
      vertical: 'ride',
      code: booking.booking_code,
      amount: payableAmount(booking),
      redirectPath: `/track/${booking.booking_code}`,
      savedMethodId: req.body.saved_method_id || null,
      saveCard: req.body.save_card === true,
    });

    return respondToCharge(res, result, booking.booking_code, async () => {
      await confirmGatewayPayment({
        vertical: 'ride',
        code: booking.booking_code,
        chargeId: result.chargeId,
        status: 'CAPTURED',
        amountPaid: result.charge && result.charge.amount,
        currency: result.charge && result.charge.currency,
      });
    });
  } catch (err) {
    console.error('createBookingCardCharge error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { tapWebhook, createBookingCardCharge };
