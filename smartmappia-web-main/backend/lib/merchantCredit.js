// ---------------------------------------------------------------------
// Reversing a merchant's platform-markup charge, shared by both verticals.
//
// CURRENTLY UNCALLED, and kept only for the historical balances it explains.
// Accepting an order used to charge its platform markup to
// merchants.credit_used; it no longer does, because the markup is collected
// once at checkout. With no charge there is nothing to reverse, so both
// cancel paths stopped calling this -- invoking it now would clamp at zero
// and quietly pay a merchant back against a balance accrued under the old
// double-billing rule.
//
// Retire this together with the rest of the credit subsystem, or repurpose
// it if credit comes back as a real mechanism. Do not wire it up again
// without deciding which.
//
// One module rather than a copy in each core: this is money arithmetic
// against a shared column, and the two verticals already mirror each other
// line for line.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { round2 } = require('./foodMoney');

// merchants.credit_used moves under a compare-and-swap, the same way every
// other writer of this column does, so two reversals (or a reversal racing an
// accept) cannot both apply against the same starting balance. A few retries
// rather than one: the caller has ALREADY cancelled the order by the time we
// get here, so giving up silently would be the money bug this exists to fix.
const MAX_ATTEMPTS = 3;

// Reverse the markup charged when this order was accepted.
//
//   orderId / shopOrderId: exactly one, naming the ledger column to fill.
//
// Returns { reversed: boolean, amount, balanceAfter } and NEVER throws — a
// failure here must not roll back a cancel that already happened. It is
// logged loudly instead, because the reconciliation is then a manual one.
async function reverseOrderMargin({ merchantId, margin, orderId, shopOrderId, orderCode, actorId }) {
  const amount = round2(Number(margin));
  if (!merchantId || !Number.isFinite(amount) || amount <= 0) {
    return { reversed: false, amount: 0, balanceAfter: null };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data: merchant, error: loadErr } = await supabase
      .from('merchants')
      .select('id, credit_used, status')
      .eq('id', merchantId)
      .maybeSingle();
    if (loadErr || !merchant) {
      console.error('reverseOrderMargin load error:', loadErr || 'merchant not found', merchantId);
      return { reversed: false, amount, balanceAfter: null };
    }

    const before = round2(Number(merchant.credit_used));
    // Clamped at zero. A negative balance would read as the platform owing
    // the merchant, which is not what this column means.
    const after = round2(Math.max(0, before - amount));

    // Status is deliberately NOT reactivated here, unlike the admin
    // replenish path. A merchant suspended by an admin for a policy reason
    // could otherwise clear their own suspension by accepting an order and
    // cancelling it. Dropping back under the limit is what an admin's
    // Reconcile is for.
    const { data: rows, error: updErr } = await supabase
      .from('merchants')
      .update({ credit_used: after })
      .eq('id', merchant.id)
      .eq('credit_used', merchant.credit_used)
      .select('id');
    if (updErr) {
      console.error('reverseOrderMargin update error:', updErr);
      return { reversed: false, amount, balanceAfter: null };
    }
    if (!rows || rows.length === 0) continue; // someone else moved it; re-read

    const { error: ledgerErr } = await supabase.from('merchant_credit_ledger').insert({
      merchant_id: merchant.id,
      order_id: orderId || null,
      shop_order_id: shopOrderId || null,
      // 'replenish' is the existing credit_ledger_type for money coming OFF
      // the balance (0011). A cancelled order is not an adjustment — it is
      // the exact charge from the accept, given back.
      type: 'replenish',
      amount,
      balance_after: after,
      note: `Reversed platform markup for cancelled order ${orderCode || ''}`.trim(),
      created_by: actorId || null,
    });
    if (ledgerErr) {
      // The balance moved but the ledger row did not. Loud, because the two
      // now disagree and only the log says by how much.
      console.error(
        'reverseOrderMargin ledger insert failed after balance moved:',
        orderCode,
        amount,
        ledgerErr
      );
    }

    return { reversed: true, amount, balanceAfter: after };
  }

  console.error(
    'reverseOrderMargin gave up after contention:',
    orderCode,
    amount,
    'merchant',
    merchantId
  );
  return { reversed: false, amount, balanceAfter: null };
}

module.exports = { reverseOrderMargin };
