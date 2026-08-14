// ---------------------------------------------------------------------
// "The card payment went through" -> the order is confirmed, automatically.
//
// ONE place where a successful gateway charge becomes a confirmed order,
// for all three verticals. There is no admin review step on the card path:
// Tap already told us the money moved, and a human re-checking that adds
// delay without adding certainty. (Manual STC Pay still goes through admin
// verification — that path has only a screenshot behind it, which is why it
// needs a human. This module is not involved there.)
//
// What "confirmed" means per vertical, because they genuinely differ:
//
//   ride  -> payment_status 'verified' + booking_status 'confirmed', and the
//            driver dispatch cascade starts immediately.
//   food  -> payment_status 'paid'. The merchant still ACCEPTS the order
//   shop     separately; that is a capacity decision (can they cook it, is
//            it in stock), not a payment decision, so it stays theirs. If
//            they already accepted while payment was pending, marking paid
//            releases it to dispatch on the spot.
//
// Every path here is idempotent. A replayed webhook, or the synchronous
// confirm racing the webhook, is a no-op rather than a double-credit.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { payableAmount } = require('./fare');

// Tolerance for the amount cross-check. Tap returns decimals and our totals
// are numeric(10,2); a hundredth of a riyal of float noise is not fraud.
const AMOUNT_EPSILON = 0.01;

// The verticals, each reduced to: find the record, what should have been
// paid, is it already paid, and how to confirm it.
//
// Lazy requires throughout — this module is pulled in by the webhook, which
// the order controllers themselves do not import, but keeping the requires
// inside the handlers avoids any load-order surprise (the same reason
// lib/payments.js defers its dispatch require).
const VERTICALS = {
  food: {
    async load(code) {
      const { loadOrder } = require('../controllers/food/ordersController');
      return loadOrder(code);
    },
    expectedAmount: (order) => Number(order.total),
    isSettled: (order) => order.payment_status === 'paid',
    async confirm(order, { chargeId, status, raw }) {
      const { markOrderPaid } = require('../controllers/food/ordersController');
      return markOrderPaid(order, {
        provider: 'tap',
        transactionId: chargeId,
        raw: { status, id: chargeId },
      });
    },
  },

  shop: {
    async load(code) {
      const { loadOrder } = require('../controllers/shop/ordersController');
      return loadOrder(code);
    },
    expectedAmount: (order) => Number(order.total),
    isSettled: (order) => order.payment_status === 'paid',
    async confirm(order, { chargeId, status }) {
      const { markShopOrderPaid } = require('../controllers/shop/ordersController');
      return markShopOrderPaid(order, {
        provider: 'tap',
        transactionId: chargeId,
        // Redacted on purpose. The full webhook body carries the card
        // object; persisting it would put card references in the database.
        raw: { status, id: chargeId },
      });
    },
  },

  ride: {
    async load(code) {
      const { data } = await supabase
        .from('bookings')
        .select(
          'id, booking_code, customer_id, fare_amount, vat_amount, vat_rate, total_amount, ' +
            'currency, payment_method, payment_status, booking_status'
        )
        .eq('booking_code', code)
        .maybeSingle();
      return data || null;
    },
    // Rides charge fare + VAT, and that snapshot is authoritative.
    expectedAmount: (booking) => payableAmount(booking),
    isSettled: (booking) => booking.payment_status === 'verified',
    async confirm(booking, { chargeId, status }) {
      const { verifyBookingPayment } = require('./payments');
      return verifyBookingPayment({
        booking,
        mode: 'gateway_webhook',
        provider: 'tap',
        gateway: { paymentId: chargeId, status, raw: { status, id: chargeId } },
      });
    },
  },
};

function isKnownVertical(vertical) {
  return Object.prototype.hasOwnProperty.call(VERTICALS, vertical);
}

// Confirm a captured charge against the order it belongs to.
//
// amountPaid/currency come from the gateway's own record of the charge (the
// verify-by-fetch result), never from a posted webhook body — the caller is
// responsible for that distinction and it is the whole reason this function
// takes an amount at all rather than trusting the charge blindly.
//
// Returns a discriminated result so the caller can log precisely:
//   { ok: true, alreadyPaid?: boolean }
//   { ok: false, reason: 'unknown_vertical' | 'not_found' | 'amount_mismatch'
//                       | 'currency_mismatch' | 'error', ... }
async function confirmGatewayPayment({ vertical, code, chargeId, status, amountPaid, currency }) {
  if (!isKnownVertical(vertical)) {
    return { ok: false, reason: 'unknown_vertical', vertical };
  }
  const handler = VERTICALS[vertical];

  const record = await handler.load(code);
  if (!record) return { ok: false, reason: 'not_found', vertical, code };

  // Already settled: a replayed webhook, or the synchronous confirm got
  // there first. Nothing to do, and importantly not an error.
  if (handler.isSettled(record)) {
    return { ok: true, alreadyPaid: true, record };
  }

  if (currency && String(currency).toUpperCase() !== 'SAR') {
    return { ok: false, reason: 'currency_mismatch', currency, record };
  }

  // The money check. We compare against OUR stored total, not against
  // anything the gateway echoed back from the request — that is what makes
  // this a control rather than a formality.
  const expected = handler.expectedAmount(record);
  if (amountPaid != null && Math.abs(Number(amountPaid) - expected) > AMOUNT_EPSILON) {
    return { ok: false, reason: 'amount_mismatch', expected, amountPaid, record };
  }

  const result = await handler.confirm(record, { chargeId, status });
  if (result && result.error) {
    return { ok: false, reason: 'error', error: result.error, record };
  }
  return {
    ok: true,
    alreadyPaid: Boolean(result && (result.alreadyPaid || result.alreadyVerified)),
    record,
  };
}

module.exports = { confirmGatewayPayment, isKnownVertical, VERTICALS };
