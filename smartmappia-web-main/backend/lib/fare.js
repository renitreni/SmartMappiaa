// ---------------------------------------------------------------------
// MVP fare model:
//   Airport Pick & Drop — flat SAR 100 base, plus a 3.75% service fee,
//   plus 15% KSA VAT on top.
//
//     base        = SAR 100.00
//     service fee = 3.75% of base = SAR 3.75
//     amount      = SAR 103.75   <- fare snapshot (bookings.fare_amount)
//     VAT (15%)   = SAR  15.56
//     totalAmount = SAR 119.31   <- what the passenger pays
//
// `amount` is the EX-VAT fare and stays the commission base: lib/ledger.js
// computeLedger() splits it between driver and platform. VAT is the
// platform's liability to the tax authority, so it is tracked separately
// (bookings.vat_amount / total_amount, migration 0025) and never enters
// the driver's cut.
//
// Both figures are stored as a SNAPSHOT on the booking and never
// recalculated after the passenger submits, keeping the agreed price fixed.
// ---------------------------------------------------------------------
const { vatFor } = require('./vat');

const FARE_BASE = 100;
const SERVICE_FEE_RATE = 0.0375; // 3.75%
const CURRENCY = 'SAR';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Quote a fresh fare. The argument is accepted (and ignored) so existing
// callers passing a routeType keep working.
function quoteFare(_opts = {}) {
  const base = FARE_BASE;
  const serviceFee = round2(base * SERVICE_FEE_RATE);
  const amount = round2(base + serviceFee);
  const { vatRate, vatAmount } = vatFor(amount);
  return {
    base,
    serviceFeeRate: SERVICE_FEE_RATE,
    serviceFee,
    amount,
    vatRate,
    vatAmount,
    totalAmount: round2(amount + vatAmount),
    currency: CURRENCY,
  };
}

// Break a stored total back into base + service fee (for receipts / instructions).
// Derived from the total so it stays correct for an existing fare snapshot.
function fareBreakdown(total) {
  const t = round2(total);
  const base = round2(t / (1 + SERVICE_FEE_RATE));
  const serviceFee = round2(t - base);
  return { base, serviceFeeRate: SERVICE_FEE_RATE, serviceFee, total: t, currency: CURRENCY };
}

// What the passenger actually pays for a STORED booking: fare + VAT.
// Reads the snapshot rather than recomputing, and falls back to the bare
// fare for bookings created before migration 0025 (which genuinely had no
// VAT line). Use this for every charge/collect amount; use fare_amount only
// where the ex-VAT commission base is wanted.
function payableAmount(booking) {
  if (!booking) return 0;
  const total = Number(booking.total_amount);
  if (Number.isFinite(total) && total > 0) return round2(total);
  return round2(booking.fare_amount);
}

// VAT actually charged on a stored booking (0 for pre-0025 bookings).
function bookingVat(booking) {
  const vat = Number(booking && booking.vat_amount);
  return Number.isFinite(vat) && vat > 0 ? round2(vat) : 0;
}

module.exports = {
  quoteFare,
  fareBreakdown,
  payableAmount,
  bookingVat,
  FARE_BASE,
  SERVICE_FEE_RATE,
  CURRENCY,
};
