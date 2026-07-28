// ---------------------------------------------------------------------
// Food order actions — accept / reject / advance status.
//
// Shared core for BOTH the admin fallback (adminFoodController.js, for
// restaurants without their own logged-in device yet) and the merchant's
// own dashboard (merchantOrdersController.js, the primary path). Money-
// sensitive logic (credit gating, platform margin charge, the ledger) lives
// here exactly once so the two callers can never diverge.
//
// Each function returns { httpStatus, body } instead of writing to `res` —
// callers just do res.status(httpStatus).json(body).
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { config } = require('./config');
const { round2, creditAfterCharge } = require('./foodMoney');
const { logFoodEvent } = require('./foodEvents');
const { logAudit } = require('./audit');
const { logNotification } = require('./notifications');
const { pushFoodOrderStatus, pushMerchantFeed, pingFoodAdmin } = require('./realtime');

// Credit summary for a restaurant (used / limit / warning / suspended).
function creditView(merchant) {
  const limit = Number(merchant.credit_limit);
  const used = round2(Number(merchant.credit_used));
  const alertAt = round2(limit * config.food.creditAlertPct);
  return {
    creditLimit: limit,
    creditUsed: used,
    creditRemaining: round2(Math.max(0, limit - used)),
    alertAt,
    warning: used >= alertAt && used < limit,
    exhausted: used >= limit,
    suspended: merchant.status === 'suspended',
  };
}

async function loadOrderByCode(code) {
  const { data } = await supabase.from('orders').select('*').eq('order_code', code).maybeSingle();
  return data;
}

async function loadMerchantById(id) {
  const { data } = await supabase.from('merchants').select('*').eq('id', id).maybeSingle();
  return data;
}

const auditAction = (base, actorRole) => (actorRole === 'admin' ? `admin_${base}` : `merchant_${base}`);

// THE credit-gated action. HARD RULE (PRD §7): a restaurant whose
// credit_used has reached the 300 SAR limit cannot take new orders (403).
// Accepting charges the order's platform margin to the ledger; crossing 80%
// (240) alerts once; hitting the limit suspends the restaurant until
// reconciled.
async function acceptOrderCore({ orderCode, actorId, actorRole }) {
  const order = await loadOrderByCode(orderCode);
  if (!order) return { httpStatus: 404, body: { error: 'Order not found' } };
  if (order.status !== 'pending') {
    return { httpStatus: 409, body: { error: `Order is already ${order.status}` } };
  }
  const merchant = await loadMerchantById(order.merchant_id);
  if (!merchant) return { httpStatus: 404, body: { error: 'Merchant not found' } };

  const margin = round2(Number(order.platform_margin_total));
  const credit = creditAfterCharge(merchant, margin);

  if (merchant.status === 'suspended' || !credit.canAccept) {
    logFoodEvent({
      eventName: 'service_suspended',
      merchantId: merchant.id,
      params: { final_balance: credit.before, merchant_id: merchant.id },
    });
    return {
      httpStatus: 403,
      body: {
        error: `${merchant.name} has used up its SAR ${credit.limit.toFixed(2)} credit ` +
          `(SAR ${credit.before.toFixed(2)}). Reconcile the balance before accepting new orders.`,
        failure_reason: 'credit_exhausted',
        credit: creditView(merchant),
      },
    };
  }

  // Charge with a compare-and-swap on the previous balance so two
  // simultaneous accepts can't both slip under the limit.
  const nextStatus = credit.exhausted ? 'suspended' : merchant.status;
  const { data: chargedRows, error: chargeErr } = await supabase
    .from('merchants')
    .update({ credit_used: credit.after, status: nextStatus })
    .eq('id', merchant.id)
    .eq('credit_used', merchant.credit_used)
    .select('id');
  if (chargeErr) {
    console.error('acceptOrderCore credit charge error:', chargeErr);
    return { httpStatus: 500, body: { error: 'Could not charge the restaurant credit' } };
  }
  if (!chargedRows || chargedRows.length === 0) {
    return { httpStatus: 409, body: { error: 'The restaurant credit changed — please retry' } };
  }

  // Flip the order pending -> accepted (also CAS); roll the charge back on a race.
  const { data: acceptedRows, error: acceptErr } = await supabase
    .from('orders')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', order.id)
    .eq('status', 'pending')
    .select('order_code');
  if (acceptErr || !acceptedRows || acceptedRows.length === 0) {
    await supabase
      .from('merchants')
      .update({ credit_used: credit.before, status: merchant.status })
      .eq('id', merchant.id)
      .eq('credit_used', credit.after);
    return { httpStatus: 409, body: { error: 'Order is no longer pending' } };
  }

  // Ledger entry: every accepted order charges its platform margin.
  await supabase.from('merchant_credit_ledger').insert({
    merchant_id: merchant.id,
    order_id: order.id,
    type: 'charge',
    amount: margin,
    balance_after: credit.after,
    note: `Platform margin for order ${order.order_code}`,
    created_by: actorId,
  });

  logFoodEvent({
    eventName: 'merchant_order_accept',
    userId: actorId,
    orderId: order.id,
    merchantId: merchant.id,
    params: { order_id: order.order_code, merchant_id: merchant.id },
  });
  logAudit({
    actorId,
    action: auditAction('food_order_accepted', actorRole),
    resourceType: 'order',
    resourceId: order.order_code,
    meta: { margin_charged: margin, credit_used_after: credit.after },
  });

  // 80% alert fires exactly once, on the charge that crosses the line.
  if (credit.crossesAlert && !credit.exhausted) {
    logFoodEvent({
      eventName: 'credit_limit_warning',
      merchantId: merchant.id,
      params: { current_usage: credit.after, merchant_id: merchant.id },
    });
  }
  if (credit.exhausted) {
    logFoodEvent({
      eventName: 'service_suspended',
      merchantId: merchant.id,
      params: { final_balance: credit.after, merchant_id: merchant.id },
    });
  }

  pushFoodOrderStatus(order.order_code, { status: 'accepted' });
  pushMerchantFeed(merchant.id, 'order_update', { orderCode: order.order_code, status: 'accepted' });
  pingFoodAdmin(order.order_code);
  logNotification({ userId: order.customer_id, type: 'food_order_accepted' });

  // Grab-style rider dispatch starts once the order is accepted AND either
  // paid or cash on delivery (the rider collects at the door). Lazy require
  // avoids a load-time circular dependency (dispatch.js also touches food
  // order state).
  if (order.payment_status === 'paid' || order.payment_method === 'cash') {
    const { startFoodDispatch } = require('./dispatch');
    startFoodDispatch(order.id);
  }

  return {
    httpStatus: 200,
    body: {
      orderCode: order.order_code,
      status: 'accepted',
      credit: creditView({ ...merchant, credit_used: credit.after, status: nextStatus }),
    },
  };
}

async function rejectOrderCore({ orderCode, actorId, actorRole, reason }) {
  const order = await loadOrderByCode(orderCode);
  if (!order) return { httpStatus: 404, body: { error: 'Order not found' } };
  if (order.status !== 'pending') {
    return { httpStatus: 409, body: { error: `Order is already ${order.status}` } };
  }

  const { data: rows } = await supabase
    .from('orders')
    .update({ status: 'rejected', reject_reason: reason || null })
    .eq('id', order.id)
    .eq('status', 'pending')
    .select('order_code');
  if (!rows || rows.length === 0) {
    return { httpStatus: 409, body: { error: 'Order is no longer pending' } };
  }

  logAudit({
    actorId,
    action: auditAction('food_order_rejected', actorRole),
    resourceType: 'order',
    resourceId: order.order_code,
    meta: { reason: reason || null, was_paid: order.payment_status === 'paid' },
  });
  pushFoodOrderStatus(order.order_code, { status: 'rejected', reason: reason || null });
  pushMerchantFeed(order.merchant_id, 'order_update', { orderCode: order.order_code, status: 'rejected' });
  pingFoodAdmin(order.order_code);
  logNotification({ userId: order.customer_id, type: 'food_order_rejected' });

  return {
    httpStatus: 200,
    body: { orderCode: order.order_code, status: 'rejected', refundDue: order.payment_status === 'paid' },
  };
}

// The fulfillment ladder — each status may only follow its predecessor.
// Riders normally advance out_for_delivery/delivered from their own portal
// (driverDispatchController.js) with mandatory photo proof; this ladder
// staying unrestricted here is intentional — restricting WHICH of these an
// actor may request is the route layer's job (the merchant route only
// allows 'preparing'/'ready'; the admin route allows the full ladder).
const NEXT_STATUS = {
  accepted: 'preparing',
  preparing: 'ready',
  ready: 'out_for_delivery',
  out_for_delivery: 'delivered',
};

async function advanceOrderStatusCore({ orderCode, actorId, actorRole, status }) {
  const order = await loadOrderByCode(orderCode);
  if (!order) return { httpStatus: 404, body: { error: 'Order not found' } };

  if (NEXT_STATUS[order.status] !== status) {
    return { httpStatus: 409, body: { error: `Cannot move an order from "${order.status}" to "${status}"` } };
  }

  const patch = { status };
  if (status === 'ready') patch.ready_at = new Date().toISOString();
  if (status === 'delivered') patch.delivered_at = new Date().toISOString();

  const { data: rows, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('id', order.id)
    .eq('status', order.status)
    .select('order_code');
  if (error || !rows || rows.length === 0) {
    return { httpStatus: 409, body: { error: 'Order status changed — please refresh' } };
  }

  // Cash on delivery settles at the door: mirror the rider portal
  // (driverDispatchController) and record the payment when this fallback
  // ladder marks the order delivered. Without this, cash orders advanced
  // this way stay 'awaiting' forever and drop out of settlement totals.
  // Best-effort: the order is already delivered at this point, so a payment
  // hiccup must not fail the request.
  if (status === 'delivered' && order.payment_method === 'cash' && order.payment_status === 'awaiting') {
    try {
      const { markOrderPaid } = require('../controllers/food/ordersController');
      await markOrderPaid(order, { provider: 'cash', actorId });
    } catch (payErr) {
      console.error('advanceOrderStatusCore cash markOrderPaid error:', payErr);
    }
  }

  logAudit({
    actorId,
    action: auditAction('food_order_status', actorRole),
    resourceType: 'order',
    resourceId: order.order_code,
    meta: { from: order.status, to: status },
  });
  pushFoodOrderStatus(order.order_code, { status });
  pushMerchantFeed(order.merchant_id, 'order_update', { orderCode: order.order_code, status });
  pingFoodAdmin(order.order_code);
  logNotification({ userId: order.customer_id, type: `food_order_${status}` });

  return { httpStatus: 200, body: { orderCode: order.order_code, status } };
}

module.exports = {
  creditView,
  loadOrderByCode,
  loadMerchantById,
  NEXT_STATUS,
  acceptOrderCore,
  rejectOrderCore,
  advanceOrderStatusCore,
};
