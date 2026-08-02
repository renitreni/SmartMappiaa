// ---------------------------------------------------------------------
// Shop order actions — accept / reject / advance status / cancel.
//
// Shared core for BOTH the admin fallback (adminShopController.js) and the
// store's own dashboard (merchantShopOrdersController.js, the primary
// path). Money-sensitive logic (credit gating, platform markup charge, the
// ledger) and stock release live here exactly once so the two callers can
// never diverge.
//
// Each function returns { httpStatus, body } instead of writing to `res` —
// callers just do res.status(httpStatus).json(body).
//
// Mirrors lib/foodOrderActions.js deliberately. The differences are:
//   * 'packing' replaces 'preparing'
//   * reject / cancel additionally release the reserved stock
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { config } = require('./config');
const { round2, creditAfterCharge } = require('./shopMoney');
const { releaseShopStock } = require('./stock');
const { logShopEvent } = require('./foodEvents');
const { logAudit } = require('./audit');
const { logNotification } = require('./notifications');
const { pushShopOrderStatus, pushMerchantFeed, pingShopAdmin } = require('./realtime');

// Credit summary for a store (used / limit / warning / suspended). The
// credit model is SHARED with food — same columns, same limit, same alert.
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
  const { data } = await supabase.from('shop_orders').select('*').eq('order_code', code).maybeSingle();
  return data;
}

async function loadMerchantById(id) {
  const { data } = await supabase.from('merchants').select('*').eq('id', id).maybeSingle();
  return data;
}

const auditAction = (base, actorRole) => (actorRole === 'admin' ? `admin_${base}` : `merchant_${base}`);

// THE credit-gated action. HARD RULE: a store whose credit_used has reached
// the 300 SAR limit cannot take new orders (403). Accepting charges the
// order's platform markup to the ledger; crossing 80% (240) alerts once;
// hitting the limit suspends the store until an admin reconciles.
async function acceptOrderCore({ orderCode, actorId, actorRole }) {
  const order = await loadOrderByCode(orderCode);
  if (!order) return { httpStatus: 404, body: { error: 'Order not found' } };
  if (order.status !== 'pending') {
    return { httpStatus: 409, body: { error: `Order is already ${order.status}` } };
  }
  const merchant = await loadMerchantById(order.merchant_id);
  if (!merchant) return { httpStatus: 404, body: { error: 'Store not found' } };

  const margin = round2(Number(order.platform_margin_total));
  const credit = creditAfterCharge(merchant, margin);

  if (merchant.status === 'suspended' || !credit.canAccept) {
    logShopEvent({
      eventName: 'service_suspended',
      merchantId: merchant.id,
      params: { final_balance: credit.before, merchant_id: merchant.id },
    });
    return {
      httpStatus: 403,
      body: {
        error:
          `${merchant.name} has used up its SAR ${credit.limit.toFixed(2)} credit ` +
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
    console.error('shop acceptOrderCore credit charge error:', chargeErr);
    return { httpStatus: 500, body: { error: 'Could not charge the store credit' } };
  }
  if (!chargedRows || chargedRows.length === 0) {
    return { httpStatus: 409, body: { error: 'The store credit changed — please retry' } };
  }

  // Flip the order pending -> accepted (also CAS); roll the charge back on a race.
  const { data: acceptedRows, error: acceptErr } = await supabase
    .from('shop_orders')
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

  await supabase.from('merchant_credit_ledger').insert({
    merchant_id: merchant.id,
    shop_order_id: order.id,
    type: 'charge',
    amount: margin,
    balance_after: credit.after,
    note: `Platform markup for order ${order.order_code}`,
    created_by: actorId,
  });

  logShopEvent({
    eventName: 'merchant_order_accept',
    userId: actorId,
    shopOrderId: order.id,
    merchantId: merchant.id,
    params: { order_id: order.order_code, merchant_id: merchant.id },
  });
  logAudit({
    actorId,
    action: auditAction('shop_order_accepted', actorRole),
    resourceType: 'shop_order',
    resourceId: order.order_code,
    meta: { margin_charged: margin, credit_used_after: credit.after },
  });

  if (credit.crossesAlert && !credit.exhausted) {
    logShopEvent({
      eventName: 'credit_limit_warning',
      merchantId: merchant.id,
      params: { current_usage: credit.after, merchant_id: merchant.id },
    });
  }
  if (credit.exhausted) {
    logShopEvent({
      eventName: 'service_suspended',
      merchantId: merchant.id,
      params: { final_balance: credit.after, merchant_id: merchant.id },
    });
  }

  pushShopOrderStatus(order.order_code, { status: 'accepted' });
  pushMerchantFeed(merchant.id, 'order_update', { orderCode: order.order_code, status: 'accepted' });
  pingShopAdmin(order.order_code);
  logNotification({
    userId: order.customer_id,
    type: 'shop_order_accepted',
    code: order.order_code,
    shopOrderId: order.id,
  });

  // Rider dispatch starts once accepted AND either paid or cash on delivery.
  if (order.payment_status === 'paid' || order.payment_method === 'cash') {
    const { startShopDispatch } = require('./dispatch');
    startShopDispatch(order.id);
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

// Reject a pending order. Unlike food, this must ALSO put the reserved
// stock back — it was taken at checkout, before the store ever saw the
// order. shop_release_stock is idempotent, so a retry is harmless.
async function rejectOrderCore({ orderCode, actorId, actorRole, reason }) {
  const order = await loadOrderByCode(orderCode);
  if (!order) return { httpStatus: 404, body: { error: 'Order not found' } };
  if (order.status !== 'pending') {
    return { httpStatus: 409, body: { error: `Order is already ${order.status}` } };
  }

  const { data: rows } = await supabase
    .from('shop_orders')
    .update({ status: 'rejected', reject_reason: reason || null })
    .eq('id', order.id)
    .eq('status', 'pending')
    .select('order_code');
  if (!rows || rows.length === 0) {
    return { httpStatus: 409, body: { error: 'Order is no longer pending' } };
  }

  const release = await releaseShopStock(order.id);

  logAudit({
    actorId,
    action: auditAction('shop_order_rejected', actorRole),
    resourceType: 'shop_order',
    resourceId: order.order_code,
    meta: { reason: reason || null, stock_released: release.released },
  });
  pushShopOrderStatus(order.order_code, { status: 'rejected', rejectReason: reason || null });
  pushMerchantFeed(order.merchant_id, 'order_update', { orderCode: order.order_code, status: 'rejected' });
  pingShopAdmin(order.order_code);
  logNotification({
    userId: order.customer_id,
    type: 'shop_order_rejected',
    code: order.order_code,
    shopOrderId: order.id,
  });

  return { httpStatus: 200, body: { orderCode: order.order_code, status: 'rejected' } };
}

// The status ladder. Each step declares which statuses it may follow, so an
// out-of-order request is a 409 rather than a silent jump.
const STATUS_FLOW = {
  packing: { from: ['accepted'], stamp: 'packed_at', notify: 'shop_order_packing' },
  ready: { from: ['accepted', 'packing'], stamp: 'ready_at', notify: 'shop_order_ready' },
  out_for_delivery: { from: ['ready'], stamp: null, notify: 'shop_order_out_for_delivery' },
  delivered: { from: ['out_for_delivery'], stamp: 'delivered_at', notify: 'shop_order_delivered' },
};

async function advanceOrderStatusCore({ orderCode, status, actorId, actorRole }) {
  const step = STATUS_FLOW[status];
  if (!step) return { httpStatus: 400, body: { error: `Unknown status "${status}"` } };

  const order = await loadOrderByCode(orderCode);
  if (!order) return { httpStatus: 404, body: { error: 'Order not found' } };
  if (!step.from.includes(order.status)) {
    return {
      httpStatus: 409,
      body: { error: `Cannot move an order from ${order.status} to ${status}` },
    };
  }

  const patch = { status };
  if (step.stamp) patch[step.stamp] = new Date().toISOString();

  const { data: rows, error } = await supabase
    .from('shop_orders')
    .update(patch)
    .eq('id', order.id)
    .eq('status', order.status)
    .select('order_code');
  if (error || !rows || rows.length === 0) {
    return { httpStatus: 409, body: { error: 'The order status changed — please retry' } };
  }

  // Cash on delivery settles HERE — the rider collected at the door, so
  // reaching 'delivered' is the payment event. Without this a cash order
  // ends delivered with payment_status still 'awaiting' and no
  // shop_order_payments row, making it invisible to every revenue and
  // settlement total. markShopOrderPaid is idempotent (the cash-once unique
  // index from 0029), so a replayed delivery cannot double-record it.
  // Retail baskets are larger than food ones and cash is offered at
  // checkout, so this matters more here than it does for food.
  if (status === 'delivered' && order.payment_method === 'cash' && order.payment_status === 'awaiting') {
    try {
      const { markShopOrderPaid } = require('../controllers/shop/ordersController');
      await markShopOrderPaid(
        { ...order, status: 'delivered' },
        { provider: 'cash', raw: { cash_collected_by: actorId }, actorId }
      );
    } catch (err) {
      // A settlement failure must not roll back a delivery that physically
      // happened; surface it loudly instead of silently losing the money.
      console.error('shop cash settlement failed for', order.order_code, err.message || err);
    }
  }

  logAudit({
    actorId,
    action: auditAction(`shop_order_${status}`, actorRole),
    resourceType: 'shop_order',
    resourceId: order.order_code,
    meta: { from: order.status, to: status },
  });
  pushShopOrderStatus(order.order_code, { status });
  pushMerchantFeed(order.merchant_id, 'order_update', { orderCode: order.order_code, status });
  pingShopAdmin(order.order_code);
  logNotification({
    userId: order.customer_id,
    type: step.notify,
    code: order.order_code,
    shopOrderId: order.id,
  });

  return { httpStatus: 200, body: { orderCode: order.order_code, status } };
}

// Cancel (admin/support, or the expiry sweeper). Releases stock. Refunding
// a paid order is a separate admin action — cancelling does not move money.
async function cancelOrderCore({ orderCode, actorId, actorRole, reason }) {
  const order = await loadOrderByCode(orderCode);
  if (!order) return { httpStatus: 404, body: { error: 'Order not found' } };
  if (['delivered', 'cancelled', 'rejected'].includes(order.status)) {
    return { httpStatus: 409, body: { error: `Order is already ${order.status}` } };
  }

  const { data: rows } = await supabase
    .from('shop_orders')
    .update({ status: 'cancelled', reject_reason: reason || null })
    .eq('id', order.id)
    .neq('status', 'cancelled')
    .select('order_code');
  if (!rows || rows.length === 0) {
    return { httpStatus: 409, body: { error: 'The order status changed — please retry' } };
  }

  const release = await releaseShopStock(order.id);

  // Withdraw any offer still on a rider's screen. Without this the offer
  // stays 'pending' and unexpired: a rider tapping Accept a few seconds
  // after the cancel wins the CAS, claims the delivery on a cancelled order,
  // and the customer gets a "rider assigned" push for an order they were
  // just told was cancelled. The food cancel does this too.
  await supabase
    .from('dispatch_offers')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('shop_order_id', order.id)
    .eq('status', 'pending');

  // Free the rider if one was holding it and had not picked up yet.
  try {
    const { releaseShopDelivery } = require('./dispatch');
    await releaseShopDelivery(order.id, { cause: 'order_cancelled', redispatch: false });
  } catch (err) {
    console.error('cancelOrderCore release delivery error:', err.message || err);
  }

  logAudit({
    actorId,
    action: auditAction('shop_order_cancelled', actorRole),
    resourceType: 'shop_order',
    resourceId: order.order_code,
    meta: { reason: reason || null, stock_released: release.released, was: order.status },
  });
  pushShopOrderStatus(order.order_code, { status: 'cancelled' });
  pushMerchantFeed(order.merchant_id, 'order_update', { orderCode: order.order_code, status: 'cancelled' });
  pingShopAdmin(order.order_code);
  logNotification({
    userId: order.customer_id,
    type: 'shop_order_cancelled',
    code: order.order_code,
    shopOrderId: order.id,
  });

  return { httpStatus: 200, body: { orderCode: order.order_code, status: 'cancelled' } };
}

module.exports = {
  creditView,
  acceptOrderCore,
  rejectOrderCore,
  advanceOrderStatusCore,
  cancelOrderCore,
  loadOrderByCode,
  STATUS_FLOW,
};
