// ---------------------------------------------------------------------
// Business Owner portal — order management (the restaurant's own live
// incoming-orders dashboard). Every query is scoped to the signed-in
// owner's restaurant via merchants.owner_id (loadOwnedMerchant, shared with
// merchantController.js). Accept/reject/advance-status share their actual
// logic (credit gating, platform margin, the fulfillment ladder) with the
// admin fallback via backend/lib/foodOrderActions.js — never duplicated.
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { requireOwnedMerchant } = require('./merchantController');
const {
  loadOrderByCode,
  acceptOrderCore,
  rejectOrderCore,
  advanceOrderStatusCore,
} = require('../lib/foodOrderActions');

// GET /api/merchant/orders — this restaurant's own orders only. Never
// selects/returns platform_margin_total: that stays confidential to admin
// (same convention as ordersController.js's customer-facing getOrder).
async function listOrders(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;

    const status = (req.query.status || '').toString();
    let query = supabase
      .from('orders')
      .select(
        'id, order_code, status, payment_status, payment_method, subtotal, delivery_fee, total, ' +
          'delivery_address, delivery_street, delivery_building, created_at, delivered_at, ' +
          'profiles!orders_customer_id_fkey ( full_name, mobile_number ), ' +
          'deliveries ( driver_id, status, pickup_photo_path, delivery_photo_path, profiles ( full_name, whatsapp_number, mobile_number ) ), ' +
          'order_items ( name_snapshot, quantity, line_total )'
      )
      .eq('merchant_id', merchant.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      console.error('merchant listOrders error:', error);
      return res.status(500).json({ error: 'Could not load orders' });
    }

    return res.json({
      orders: (data || []).map((o) => {
        const delivery = Array.isArray(o.deliveries) ? o.deliveries[0] : o.deliveries;
        const rider = delivery && delivery.profiles ? delivery.profiles : null;
        return {
          // The order's own code doubles as the pickup-verification code —
          // compare what the driver states against this before handing over
          // the food.
          orderCode: o.order_code,
          status: o.status,
          paymentStatus: o.payment_status,
          paymentMethod: o.payment_method,
          subtotal: o.subtotal,
          deliveryFee: o.delivery_fee,
          total: o.total,
          deliveryAddress: o.delivery_address,
          deliveryStreet: o.delivery_street,
          deliveryBuilding: o.delivery_building,
          customerName: o.profiles ? o.profiles.full_name : null,
          customerMobile: o.profiles ? o.profiles.mobile_number : null,
          items: o.order_items || [],
          riderName: rider ? rider.full_name : null,
          riderWhatsapp: rider ? rider.whatsapp_number : null,
          riderMobile: rider ? rider.mobile_number : null,
          riderAssigned: !!delivery,
          hasPickupPhoto: !!(delivery && delivery.pickup_photo_path),
          hasDeliveryPhoto: !!(delivery && delivery.delivery_photo_path),
          createdAt: o.created_at,
          deliveredAt: o.delivered_at,
        };
      }),
    });
  } catch (err) {
    console.error('merchant listOrders error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Every mutating action here first confirms the order actually belongs to
// the signed-in restaurant (404, not 403, so a wrong/foreign order code
// doesn't reveal that a valid order exists elsewhere) before touching the
// shared core — the core itself trusts the caller already did this check.
async function assertOwnedOrder(req, res, merchant) {
  const order = await loadOrderByCode(req.params.code);
  if (!order || order.merchant_id !== merchant.id) {
    res.status(404).json({ error: 'Order not found' });
    return null;
  }
  return order;
}

async function acceptOrder(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;
    if (!(await assertOwnedOrder(req, res, merchant))) return;

    const { httpStatus, body } = await acceptOrderCore({
      orderCode: req.params.code,
      actorId: req.merchantOwnerId,
      actorRole: 'merchant',
    });
    return res.status(httpStatus).json(body);
  } catch (err) {
    console.error('merchant acceptOrder error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function rejectOrder(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;
    if (!(await assertOwnedOrder(req, res, merchant))) return;

    const { httpStatus, body } = await rejectOrderCore({
      orderCode: req.params.code,
      actorId: req.merchantOwnerId,
      actorRole: 'merchant',
      reason: (req.body && req.body.reason) || null,
    });
    return res.status(httpStatus).json(body);
  } catch (err) {
    console.error('merchant rejectOrder error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Merchant authority stops at "ready" — the route's validateBody enum
// (['preparing', 'ready']) is the actual enforcement of that limit; this
// handler doesn't need its own extra guard because advanceOrderStatusCore
// will simply reject any status that isn't the immediate next rung anyway.
async function advanceStatus(req, res) {
  try {
    const merchant = await requireOwnedMerchant(req, res);
    if (!merchant) return;
    if (!(await assertOwnedOrder(req, res, merchant))) return;

    const { httpStatus, body } = await advanceOrderStatusCore({
      orderCode: req.params.code,
      actorId: req.merchantOwnerId,
      actorRole: 'merchant',
      status: req.body.status,
    });
    return res.status(httpStatus).json(body);
  } catch (err) {
    console.error('merchant advanceStatus error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { listOrders, acceptOrder, rejectOrder, advanceStatus };
