// ---------------------------------------------------------------------
// Store owner portal — the live orders queue.
//
// Thin by design: accept / reject / advance all delegate to
// lib/shopOrderActions.js, which is the SAME code the admin fallback runs.
// Money-critical behaviour (the credit gate, the markup charge, the ledger
// row, the stock release on reject) therefore cannot drift between the two
// entry points.
//
// WHAT A STORE MAY NOT SEE: platform_margin_total is absent from the select
// below. The store knows its list prices and what it is owed; our cut is
// not its business, and 0029 hides the column from the anon key for the
// same reason.
//
// WHAT A STORE MAY NOT DO: advance past 'ready'. out_for_delivery and
// delivered are rider-only, evidenced by photo proof and a geofence. The
// route schema enforces this; so does STATUS_FLOW in shopOrderActions.
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const {
  acceptOrderCore,
  rejectOrderCore,
  advanceOrderStatusCore,
  creditView,
} = require('../lib/shopOrderActions');
const { requireOwnedStore } = require('./merchantShopController');

const ORDER_SELECT =
  'id, order_code, status, subtotal, delivery_fee, vat_amount, vat_rate, total, ' +
  'delivery_address, contact_phone, payment_status, payment_method, reject_reason, ' +
  'created_at, accepted_at, packed_at, ready_at, delivered_at, ' +
  'shop_order_items ( id, name_snapshot, variant_label_snapshot, sku_snapshot, ' +
  'unit_price, quantity, line_total ), ' +
  'shop_deliveries ( status, driver_id, pickup_photo_path, delivery_photo_path ), ' +
  'profiles!shop_orders_customer_id_fkey ( full_name, mobile_number, whatsapp_number )';

// A foreign order code is a 404, never a 403: a store must not be able to
// probe whether an order code exists at another store.
async function assertOwnedOrder(storeId, code, res) {
  const { data } = await supabase
    .from('shop_orders')
    .select('id, merchant_id')
    .eq('order_code', code)
    .maybeSingle();
  if (!data || data.merchant_id !== storeId) {
    res.status(404).json({ error: 'Order not found' });
    return false;
  }
  return true;
}

async function listOrders(req, res) {
  try {
    const store = await requireOwnedStore(req, res);
    if (!store) return undefined;

    const { data, error } = await supabase
      .from('shop_orders')
      .select(ORDER_SELECT)
      .eq('merchant_id', store.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('merchant shop listOrders error:', error);
      return res.status(500).json({ error: 'Could not load your orders' });
    }

    return res.json({
      orders: (data || []).map((o) => {
        const delivery = Array.isArray(o.shop_deliveries) ? o.shop_deliveries[0] : o.shop_deliveries;
        const customer = o.profiles;
        return {
          orderCode: o.order_code,
          status: o.status,
          subtotal: o.subtotal,
          deliveryFee: o.delivery_fee,
          vatAmount: o.vat_amount,
          vatRate: o.vat_rate,
          total: o.total,
          deliveryAddress: o.delivery_address,
          contactPhone: o.contact_phone,
          paymentStatus: o.payment_status,
          paymentMethod: o.payment_method,
          rejectReason: o.reject_reason,
          createdAt: o.created_at,
          acceptedAt: o.accepted_at,
          packedAt: o.packed_at,
          readyAt: o.ready_at,
          deliveredAt: o.delivered_at,
          items: o.shop_order_items || [],
          customer: customer
            ? {
                name: customer.full_name,
                // The order's own number wins: the customer may have edited
                // it after placing the order.
                mobile: o.contact_phone || customer.mobile_number,
                whatsapp: customer.whatsapp_number,
              }
            : null,
          rider: delivery
            ? {
                status: delivery.status,
                assigned: !!delivery.driver_id,
                hasPickupPhoto: !!delivery.pickup_photo_path,
                hasDeliveryPhoto: !!delivery.delivery_photo_path,
              }
            : null,
        };
      }),
      credit: creditView(store),
    });
  } catch (err) {
    console.error('merchant shop listOrders error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function acceptOrder(req, res) {
  try {
    const store = await requireOwnedStore(req, res);
    if (!store) return undefined;
    if (!(await assertOwnedOrder(store.id, req.params.code, res))) return undefined;

    const { httpStatus, body } = await acceptOrderCore({
      orderCode: req.params.code,
      actorId: req.merchantOwnerId,
      actorRole: 'merchant',
    });
    return res.status(httpStatus).json(body);
  } catch (err) {
    console.error('merchant shop acceptOrder error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function rejectOrder(req, res) {
  try {
    const store = await requireOwnedStore(req, res);
    if (!store) return undefined;
    if (!(await assertOwnedOrder(store.id, req.params.code, res))) return undefined;

    const { httpStatus, body } = await rejectOrderCore({
      orderCode: req.params.code,
      actorId: req.merchantOwnerId,
      actorRole: 'merchant',
      reason: req.body.reason || null,
    });
    return res.status(httpStatus).json(body);
  } catch (err) {
    console.error('merchant shop rejectOrder error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function advanceStatus(req, res) {
  try {
    const store = await requireOwnedStore(req, res);
    if (!store) return undefined;
    if (!(await assertOwnedOrder(store.id, req.params.code, res))) return undefined;

    const { httpStatus, body } = await advanceOrderStatusCore({
      orderCode: req.params.code,
      status: req.body.status, // route schema caps this at packing | ready
      actorId: req.merchantOwnerId,
      actorRole: 'merchant',
    });
    return res.status(httpStatus).json(body);
  } catch (err) {
    console.error('merchant shop advanceStatus error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { listOrders, acceptOrder, rejectOrder, advanceStatus };
