// ---------------------------------------------------------------------
// KSA VAT — the single source of truth for tax math on BOTH services
// (food orders and Pick & Drop rides).
//
// VAT is charged ON TOP of the pre-tax base and the rate is snapshotted
// onto the order/booking row at creation (migration 0025), so a receipt
// reprinted after a rate change still shows the tax that was actually
// charged. Never recompute tax on a historical row from config — read its
// stored vat_amount / vat_rate.
//
// VAT is a liability to the tax authority, not revenue: it is excluded
// from the merchant payout base (subtotal - margin) and from the driver
// commission base (lib/ledger.js computeLedger reads fare_amount, which
// stays ex-VAT on purpose).
// ---------------------------------------------------------------------
const { config } = require('./config');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Tax on a pre-tax base, plus the rate that produced it (for the snapshot).
//   vatFor(50) -> { vatRate: 0.15, vatAmount: 7.5 }
function vatFor(base) {
  const vatRate = config.vat.rate;
  const amount = Number(base);
  if (!Number.isFinite(amount) || amount <= 0) return { vatRate, vatAmount: 0 };
  return { vatRate, vatAmount: round2(amount * vatRate) };
}

// Human label for receipts and summary rows: "VAT (15%)".
function vatLabel(rate = config.vat.rate) {
  const pct = round2(Number(rate) * 100);
  return `VAT (${pct}%)`;
}

module.exports = { vatFor, vatLabel };
