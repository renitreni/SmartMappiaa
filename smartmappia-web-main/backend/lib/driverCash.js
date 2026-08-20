// ---------------------------------------------------------------------
// Driver cash-owed settlement (pick & drop cash rides). Mirrors
// lib/foodMoney.js + lib/ledger.js, inverted: instead of the platform
// holding money it owes a partner, the driver holds fare money they owe
// the platform.
//
//   * a completed cash ride adds its platform_net (commission) to cash_owed
//   * at/over cash_owed_limit the driver cannot accept new cash rides
//   * an admin 'settlement' reduces cash_owed back down (weekly cadence)
//
// The cashAfterCharge / driverCashView / isBlockedFromCash functions are
// pure; chargeDriverCashOwed / settleDriverCash write the running balance
// (profiles.cash_owed) and the audit trail (driver_cash_ledger).
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { config } = require('./config');

const { round2 } = require('./money');

function limitFor(driver) {
  const raw = Number(driver.cash_owed_limit);
  return Number.isFinite(raw) && raw > 0 ? raw : config.ledger.cashOwedLimit;
}

// State after (hypothetically) charging `amount` to a driver's cash_owed.
function cashAfterCharge(driver, amount) {
  const limit = limitFor(driver);
  const before = round2(Number(driver.cash_owed) || 0);
  const after = round2(before + round2(amount));
  const alertAt = round2(limit * config.ledger.cashOwedAlertPct);
  return {
    limit,
    before,
    after,
    alertAt,
    // At/over the cap the driver cannot accept new cash rides.
    canAcceptCash: before < limit,
    crossesAlert: before < alertAt && after >= alertAt,
    exhausted: after >= limit,
  };
}

// A driver is blocked from cash rides once their running balance reaches
// the cap (before any new charge).
function isBlockedFromCash(driver) {
  return round2(Number(driver.cash_owed) || 0) >= limitFor(driver);
}

// API-facing shape for the driver app + admin settlement screen.
function driverCashView(driver) {
  const limit = limitFor(driver);
  const owed = round2(Number(driver.cash_owed) || 0);
  const alertAt = round2(limit * config.ledger.cashOwedAlertPct);
  return {
    cashOwed: owed,
    cashOwedLimit: limit,
    cashRemaining: round2(Math.max(0, limit - owed)),
    alertAt,
    warning: owed >= alertAt && owed < limit,
    blocked: owed >= limit,
  };
}

// --- Balance writers (profiles.cash_owed + driver_cash_ledger) ------------

// Add `amount` (a ride's platform commission) to a driver's cash_owed and
// append a 'charge' ledger row. CAS on the previous balance so two writes
// can't both slip past. Best-effort by design — callers log and move on.
async function chargeDriverCashOwed({ driverId, bookingId = null, amount, note = null }) {
  const charge = round2(amount);
  if (!(charge > 0)) return { ok: true, skipped: true };

  const { data: drv, error: readErr } = await supabase
    .from('profiles')
    .select('cash_owed')
    .eq('id', driverId)
    .single();
  if (readErr || !drv) {
    console.error('chargeDriverCashOwed read error:', readErr);
    return { error: readErr || new Error('driver not found') };
  }

  const before = round2(Number(drv.cash_owed) || 0);
  const after = round2(before + charge);
  const { data: updated, error: updErr } = await supabase
    .from('profiles')
    .update({ cash_owed: after })
    .eq('id', driverId)
    .eq('cash_owed', drv.cash_owed) // CAS against a racing charge/settlement
    .select('id');
  if (updErr || !updated || updated.length === 0) {
    console.error('chargeDriverCashOwed update error (or race):', updErr);
    return { error: updErr || new Error('cash_owed changed, retry') };
  }

  await supabase.from('driver_cash_ledger').insert({
    driver_id: driverId,
    booking_id: bookingId,
    type: 'charge',
    amount: charge,
    balance_after: after,
    note,
  });
  return { ok: true, balanceAfter: after };
}

// Record that a driver paid SmartMappia `amount` toward what they owe:
// reduce cash_owed (never below 0) and append a 'settlement' ledger row.
async function settleDriverCash({ driverId, amount, adminId = null, note = null }) {
  const paid = round2(amount);
  if (!(paid > 0)) return { error: new Error('amount must be > 0') };

  const { data: drv, error: readErr } = await supabase
    .from('profiles')
    .select('cash_owed')
    .eq('id', driverId)
    .single();
  if (readErr || !drv) return { error: readErr || new Error('driver not found') };

  const after = round2(Math.max(0, round2(Number(drv.cash_owed) || 0) - paid));
  const { data: updated, error: updErr } = await supabase
    .from('profiles')
    .update({ cash_owed: after })
    .eq('id', driverId)
    .eq('cash_owed', drv.cash_owed) // CAS against a racing charge
    .select('id, cash_owed, cash_owed_limit');
  if (updErr || !updated || updated.length === 0) {
    return { error: updErr || new Error('cash_owed changed, retry') };
  }

  await supabase.from('driver_cash_ledger').insert({
    driver_id: driverId,
    type: 'settlement',
    amount: paid,
    balance_after: after,
    note,
    created_by: adminId,
  });
  return { ok: true, balanceAfter: after };
}

module.exports = {
  round2,
  cashAfterCharge,
  isBlockedFromCash,
  driverCashView,
  limitFor,
  chargeDriverCashOwed,
  settleDriverCash,
};
