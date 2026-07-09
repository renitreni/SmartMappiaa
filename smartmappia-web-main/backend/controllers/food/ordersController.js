// ---------------------------------------------------------------------
// Food Delivery — customer orders: checkout, payment, tracking, history
//   - checkout            : POST /api/food/orders
//   - listOrders          : GET  /api/food/orders
//   - getOrder            : GET  /api/food/orders/:code
//   - getPaymentInfo      : GET  /api/food/orders/:code/pay
//   - createPayUploadUrl  : POST /api/food/orders/:code/pay/signed-url
//   - recordPayment       : POST /api/food/orders/:code/pay
//   - createTapCharge     : POST /api/food/orders/:code/tap-charge
//   - tapWebhook          : POST /api/food/webhooks/tap
//
// HARD RULES enforced here (never client-side):
//   * money is recomputed from DB menu prices via lib/foodMoney.js —
//     any client-sent totals are ignored (the schema doesn't accept them)
//   * subtotal < 30 SAR  -> 422 { failure_reason: 'min_order' }
//   * outside the 15 km radius -> 422 { failure_reason: 'outside_radius' }
//   * only the gateway token / transaction id is stored, never card data
// ---------------------------------------------------------------------
const crypto = require('crypto');
const { supabase } = require('../../lib/supabase');
const { config } = require('../../lib/config');
const { haversineKm, etaMinutes } = require('../../lib/geo');
const { priceOrder } = require('../../lib/foodMoney');
const { logFoodEvent } = require('../../lib/foodEvents');
const { logAudit } = require('../../lib/audit');
const { logNotification } = require('../../lib/notifications');
const { pushFoodOrderStatus, pushMerchantFeed, pingFoodAdmin } = require('../../lib/realtime');
const { buildProofPath, createProofUploadUrl } = require('../../lib/storage');

// Payment statuses from which the customer may still (re)submit payment.
const PAYABLE_STATUSES = ['awaiting', 'failed'];

const ORDER_SELECT =
  'id, order_code, customer_id, merchant_id, status, subtotal, delivery_fee, ' +
  'platform_margin_total, total, distance_km, delivery_address, delivery_lat, delivery_lng, ' +
  'payment_status, payment_method, created_at, accepted_at, ready_at, delivered_at, reject_reason';

// Small helper: load an order by code, or null.
async function loadOrder(orderCode) {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('order_code', orderCode)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// The caller must own the order (admins pass for support).
function assertOwner(req, res, order) {
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return false;
  }
  if (order.customer_id !== req.userId && req.role !== 'admin') {
    res.status(403).json({ error: 'This order belongs to another account' });
    return false;
  }
  return true;
}

// --- Checkout --------------------------------------------------------
async function checkout(req, res) {
  try {
    const b = req.body; // validated by the route schema

    // 1. The restaurant must exist and be open for business.
    const { data: merchant, error: mErr } = await supabase
      .from('merchants')
      .select('id, name, is_active, status, lat, lng, service_radius_km, owner_id')
      .eq('id', b.merchant_id)
      .maybeSingle();
    if (mErr) {
      console.error('checkout merchant load error:', mErr);
      return res.status(500).json({ error: 'Could not load the restaurant' });
    }
    if (!merchant || !merchant.is_active || merchant.status !== 'active') {
      return res.status(409).json({
        error: 'This restaurant is not accepting orders right now',
        failure_reason: 'restaurant_unavailable',
      });
    }

    // 2. Load the caller's cart for this restaurant.
    const { data: cart } = await supabase
      .from('carts')
      .select('id')
      .eq('customer_id', req.userId)
      .eq('merchant_id', merchant.id)
      .maybeSingle();
    const { data: cartLines } = cart
      ? await supabase
          .from('cart_items')
          .select('menu_item_id, quantity')
          .eq('cart_id', cart.id)
      : { data: [] };
    if (!cartLines || cartLines.length === 0) {
      return res.status(422).json({ error: 'Your cart is empty', failure_reason: 'empty_cart' });
    }

    // 3. Re-read the LIVE menu rows — prices/margins come from here, not
    //    from the cart snapshot and certainly not from the client.
    const { data: menuRows, error: menuErr } = await supabase
      .from('menu_items')
      .select('id, name, price, item_type, is_available, merchant_id')
      .in('id', cartLines.map((l) => l.menu_item_id));
    if (menuErr) {
      console.error('checkout menu load error:', menuErr);
      return res.status(500).json({ error: 'Could not load menu prices' });
    }
    const menuById = new Map((menuRows || []).map((m) => [m.id, m]));

    const unavailable = [];
    const items = [];
    for (const line of cartLines) {
      const menu = menuById.get(line.menu_item_id);
      if (!menu || !menu.is_available || menu.merchant_id !== merchant.id) {
        unavailable.push(menu ? menu.name : 'a removed item');
      } else {
        items.push({
          menuItemId: menu.id,
          name: menu.name,
          unitPrice: Number(menu.price),
          quantity: line.quantity,
          itemType: menu.item_type,
        });
      }
    }
    if (unavailable.length) {
      return res.status(409).json({
        error: `Some items are no longer available: ${unavailable.join(', ')}. Please update your cart.`,
        failure_reason: 'item_unavailable',
        items: unavailable,
      });
    }

    // 4. Distance for the 15 km delivery-fee rule (merchant -> customer).
    //    Null when the restaurant has no pin yet — the flat promo fee applies.
    const distanceKm = haversineKm(
      { lat: merchant.lat, lng: merchant.lng },
      { lat: b.delivery_lat, lng: b.delivery_lng }
    );

    // 5. THE money math — single source of truth.
    const priced = priceOrder({ items, distanceKm });
    if (!priced.ok) {
      logFoodEvent({
        eventName: 'checkout_attempt',
        userId: req.userId,
        merchantId: merchant.id,
        params: { order_total: priced.subtotal ?? null, failure_reason: priced.failureReason },
      });
      const message =
        priced.failureReason === 'min_order'
          ? `Minimum order is SAR ${priced.minOrder.toFixed(2)}. Add SAR ${priced.shortfall.toFixed(2)} more to check out.`
          : `This address is outside the ${priced.radiusKm} km delivery radius.`;
      return res.status(422).json({ error: message, failure_reason: priced.failureReason, ...priced });
    }

    // 6. Create the order (order_code comes from gen_order_code()).
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        customer_id: req.userId,
        merchant_id: merchant.id,
        subtotal: priced.subtotal,
        delivery_fee: priced.deliveryFee,
        platform_margin_total: priced.marginTotal,
        total: priced.total,
        distance_km: distanceKm != null ? Math.round(distanceKm * 100) / 100 : null,
        delivery_address: b.delivery_address,
        delivery_lat: b.delivery_lat ?? null,
        delivery_lng: b.delivery_lng ?? null,
        payment_method: b.payment_method || 'stcpay',
      })
      .select(ORDER_SELECT)
      .single();
    if (orderErr) {
      console.error('checkout order insert error:', orderErr);
      return res.status(500).json({ error: 'Could not create the order' });
    }

    const { error: itemsErr } = await supabase.from('order_items').insert(
      priced.lines.map((line) => ({
        order_id: order.id,
        menu_item_id: line.menuItemId,
        name_snapshot: line.name,
        unit_price: line.unitPrice,
        quantity: line.quantity,
        line_total: line.lineTotal,
        margin_per_item: line.marginPerItem,
        margin_total: line.marginTotal,
      }))
    );
    if (itemsErr) {
      console.error('checkout order_items insert error:', itemsErr);
      await supabase.from('orders').delete().eq('id', order.id); // don't leave a headless order
      return res.status(500).json({ error: 'Could not create the order items' });
    }

    // 7. Clear the cart (cascade removes its lines).
    if (cart) await supabase.from('carts').delete().eq('id', cart.id);

    logFoodEvent({
      eventName: 'checkout_attempt',
      userId: req.userId,
      orderId: order.id,
      merchantId: merchant.id,
      params: { order_total: priced.total },
    });
    logAudit({
      actorId: req.userId,
      action: 'food_order_created',
      resourceType: 'order',
      resourceId: order.order_code,
      meta: { merchant_id: merchant.id, total: priced.total },
    });
    pushMerchantFeed(merchant.id, 'new_order', {
      orderCode: order.order_code,
      status: order.status,
      paymentStatus: order.payment_status,
      total: order.total,
    });
    pingFoodAdmin(order.order_code);

    return res.status(201).json({
      orderCode: order.order_code,
      status: order.status,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method,
      subtotal: order.subtotal,
      deliveryFee: order.delivery_fee,
      total: order.total,
      distanceKm: order.distance_km,
      next: `/api/food/orders/${order.order_code}/pay`,
    });
  } catch (err) {
    console.error('checkout error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- History + tracking ----------------------------------------------
async function listOrders(req, res) {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`${ORDER_SELECT}, merchants ( id, name, logo_url, cuisine_type )`)
      .eq('customer_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      console.error('listOrders error:', error);
      return res.status(500).json({ error: 'Could not load your orders' });
    }
    return res.json({
      orders: (data || []).map(({ id, customer_id, ...order }) => order),
    });
  } catch (err) {
    console.error('listOrders error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function getOrder(req, res) {
  try {
    const order = await loadOrder(req.params.code);
    if (!assertOwner(req, res, order)) return undefined;

    const [{ data: items }, { data: merchant }, { data: delivery }] = await Promise.all([
      supabase
        .from('order_items')
        .select('name_snapshot, unit_price, quantity, line_total')
        .eq('order_id', order.id),
      supabase
        .from('merchants')
        .select('id, name, logo_url, cuisine_type, address, lat, lng')
        .eq('id', order.merchant_id)
        .maybeSingle(),
      // The rider leg (Grab-style): name + contact of the assigned driver
      // so the customer can call / WhatsApp them from the tracking page.
      supabase
        .from('deliveries')
        .select('status, driver_id, profiles ( full_name, whatsapp_number, mobile_number )')
        .eq('order_id', order.id)
        .maybeSingle(),
    ]);

    let rider = null;
    if (delivery && delivery.profiles) {
      rider = {
        name: delivery.profiles.full_name,
        whatsapp: delivery.profiles.whatsapp_number,
        mobile: delivery.profiles.mobile_number,
        status: delivery.status,
        location: null,
        etaMinutes: null,
      };
      // Live pin: the rider's most recent GPS fix (their device pings every
      // ~12s while online) + a rough ETA to the drop-off point.
      const { data: lastFix } = await supabase
        .from('driver_locations')
        .select('lat, lng, recorded_at')
        .eq('driver_id', delivery.driver_id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastFix) {
        rider.location = { lat: lastFix.lat, lng: lastFix.lng, at: lastFix.recorded_at };
        const dist = haversineKm(lastFix, { lat: order.delivery_lat, lng: order.delivery_lng });
        rider.etaMinutes = etaMinutes(dist);
      }
    }

    // Has this customer already rated the rider? (drives the stars widget)
    let driverRating = null;
    if (order.status === 'delivered') {
      const { data: rating } = await supabase
        .from('driver_ratings')
        .select('stars, comment')
        .eq('order_id', order.id)
        .maybeSingle();
      if (rating) driverRating = rating;
    }

    const { id, customer_id, ...publicOrder } = order;
    return res.json({ order: publicOrder, items: items || [], merchant: merchant || null, rider, driverRating });
  } catch (err) {
    console.error('getOrder error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Payment: STC Pay (manual, live path) ------------------------------
async function getPaymentInfo(req, res) {
  try {
    const order = await loadOrder(req.params.code);
    if (!assertOwner(req, res, order)) return undefined;

    // Cash on delivery: nothing to pay online — the rider collects.
    if (order.payment_method === 'cash') {
      return res.json({
        orderCode: order.order_code,
        paymentStatus: order.payment_status,
        paymentMethod: 'cash',
        amount: order.total,
        currency: 'SAR',
        instructions: [
          `Pay SAR ${Number(order.total).toFixed(2)} in cash to your rider when the order arrives.`,
        ],
      });
    }

    return res.json({
      orderCode: order.order_code,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method,
      amount: order.total,
      currency: 'SAR',
      stcPay: {
        number: config.stcPay.number,
        recipientName: config.stcPay.recipientName,
      },
      // The order code IS the transfer note so payments can be matched.
      reference: order.order_code,
      tapAvailable: !!config.tap.secretKey,
      instructions: [
        `Open STC Pay and send SAR ${Number(order.total).toFixed(2)} to ${config.stcPay.number} (${config.stcPay.recipientName}).`,
        `Put your order code ${order.order_code} in the transfer note.`,
        'Take a screenshot of the successful transfer.',
        'Upload that screenshot below to confirm your order.',
      ],
      testMode: config.autoVerifyTestMode,
    });
  } catch (err) {
    console.error('getPaymentInfo error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function createPayUploadUrl(req, res) {
  try {
    const order = await loadOrder(req.params.code);
    if (!assertOwner(req, res, order)) return undefined;
    if (order.payment_method === 'cash') {
      return res.status(409).json({ error: 'This order is cash on delivery — pay the rider directly' });
    }
    if (!PAYABLE_STATUSES.includes(order.payment_status)) {
      return res.status(409).json({
        error: `Payment is already ${order.payment_status}; a new proof cannot be uploaded`,
      });
    }

    const { file_name, mime_type } = req.body;
    if (!mime_type || !config.proofs.allowedMimeTypes.includes(mime_type)) {
      return res.status(400).json({
        error: `mime_type is required and must be one of: ${config.proofs.allowedMimeTypes.join(', ')}`,
      });
    }

    // Same private payment-proofs bucket as Pick & Drop; FD- prefix keys it.
    const path = buildProofPath(order.order_code, file_name);
    const { token, signedUrl } = await createProofUploadUrl(path);

    return res.status(201).json({
      bucket: config.proofs.bucket,
      path,
      token,
      signedUrl,
      maxBytes: config.proofs.maxBytes,
      next: `/api/food/orders/${order.order_code}/pay`,
    });
  } catch (err) {
    console.error('createPayUploadUrl error:', err);
    return res.status(500).json({ error: 'Could not create upload URL' });
  }
}

// Mark an order paid + record the confirmation. Shared by the test-mode
// auto-verify, the admin manual verify, and the Tap webhook — all paths
// stay idempotent because order_payments.gateway_transaction_id is unique.
async function markOrderPaid(order, { provider, transactionId = null, raw = null, actorId = null, skipPaymentRow = false }) {
  // skipPaymentRow: the caller already has a paid order_payments row (admin
  // verify promotes the awaiting proof row) — don't insert a duplicate.
  let paymentId = null;
  if (!skipPaymentRow) {
    const { data: payment, error: payErr } = await supabase
      .from('order_payments')
      .insert({
        order_id: order.id,
        provider,
        amount: order.total,
        status: 'paid',
        gateway_transaction_id: transactionId,
        gateway_raw: raw,
      })
      .select('id')
      .single();
    if (payErr) {
      // 23505 = unique violation on gateway_transaction_id: already confirmed.
      if (payErr.code === '23505') return { alreadyPaid: true };
      throw payErr;
    }
    paymentId = payment.id;
  }

  await supabase.from('orders').update({
    payment_status: 'paid',
    ...(transactionId != null ? { gateway_transaction_id: transactionId } : {}),
  }).eq('id', order.id);

  logFoodEvent({
    eventName: 'payment_success',
    userId: order.customer_id,
    orderId: order.id,
    merchantId: order.merchant_id,
    params: { transaction_id: transactionId, payment_method: provider, amount: Number(order.total) },
  });
  logAudit({
    actorId,
    action: 'food_payment_confirmed',
    resourceType: 'order',
    resourceId: order.order_code,
    meta: { provider, amount: Number(order.total) },
  });
  logNotification({ userId: order.customer_id, type: 'food_payment_confirmed', code: order.order_code });

  pushFoodOrderStatus(order.order_code, { paymentStatus: 'paid', status: order.status });
  pushMerchantFeed(order.merchant_id, 'payment_update', {
    orderCode: order.order_code,
    paymentStatus: 'paid',
  });
  pingFoodAdmin(order.order_code);

  // If the merchant already accepted while payment was pending, the order is
  // now dispatchable — start the Grab-style rider cascade.
  if (['accepted', 'preparing', 'ready'].includes(order.status)) {
    const { startFoodDispatch } = require('../../lib/dispatch');
    startFoodDispatch(order.id);
  }
  return { paymentId };
}

async function recordPayment(req, res) {
  try {
    const order = await loadOrder(req.params.code);
    if (!assertOwner(req, res, order)) return undefined;
    if (order.payment_method === 'cash') {
      return res.status(409).json({ error: 'This order is cash on delivery — pay the rider directly' });
    }
    if (!PAYABLE_STATUSES.includes(order.payment_status)) {
      return res.status(409).json({
        error: `Payment is already ${order.payment_status}; a new proof cannot be recorded`,
      });
    }

    const b = req.body;
    if (!String(b.path || '').startsWith(`${order.order_code}/`)) {
      return res.status(400).json({
        error: 'Validation failed',
        details: ['path does not belong to this order'],
      });
    }
    if (b.size_bytes != null && Number(b.size_bytes) > config.proofs.maxBytes) {
      return res.status(400).json({
        error: 'Validation failed',
        details: [`file exceeds max size of ${config.proofs.maxBytes} bytes`],
      });
    }

    // TEST MODE ONLY: skip admin review and confirm instantly.
    if (config.autoVerifyTestMode) {
      await markOrderPaid(order, {
        provider: 'stcpay',
        transactionId: b.reference || null,
        raw: { proof_path: b.path, test_auto: true },
        actorId: req.userId,
      });
      return res.status(201).json({
        orderCode: order.order_code,
        paymentStatus: 'paid',
        autoVerified: true,
      });
    }

    // Normal flow: record the proof, keep 'awaiting' until an admin verifies.
    const { error: payErr } = await supabase.from('order_payments').insert({
      order_id: order.id,
      provider: 'stcpay',
      amount: order.total,
      status: 'awaiting',
      gateway_transaction_id: b.reference || null,
      gateway_raw: {
        proof_path: b.path,
        file_name: b.file_name || null,
        mime_type: b.mime_type || null,
        size_bytes: b.size_bytes || null,
      },
    });
    if (payErr) {
      if (payErr.code === '23505') {
        return res.status(409).json({ error: 'This payment reference was already submitted' });
      }
      console.error('recordPayment insert error:', payErr);
      return res.status(500).json({ error: 'Could not record the payment' });
    }

    logAudit({
      actorId: req.userId,
      action: 'food_payment_proof_uploaded',
      resourceType: 'order',
      resourceId: order.order_code,
    });
    pushMerchantFeed(order.merchant_id, 'payment_update', {
      orderCode: order.order_code,
      paymentStatus: 'awaiting',
    });
    pingFoodAdmin(order.order_code);

    return res.status(201).json({
      orderCode: order.order_code,
      paymentStatus: 'awaiting',
      autoVerified: false,
      message: 'Payment proof received. Your order will be confirmed once the payment is verified.',
    });
  } catch (err) {
    console.error('recordPayment error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Payment: Tap (online, deferred) -----------------------------------
async function createTapCharge(req, res) {
  try {
    if (!config.tap.secretKey) {
      return res.status(503).json({ error: 'Tap Payments is not configured yet. Please pay with STC Pay.' });
    }
    const order = await loadOrder(req.params.code);
    if (!assertOwner(req, res, order)) return undefined;
    if (!PAYABLE_STATUSES.includes(order.payment_status)) {
      return res.status(409).json({ error: `Payment is already ${order.payment_status}` });
    }

    // Hosted redirect: Tap collects the card inside its own PCI-DSS
    // environment; we only ever see the charge id.
    const response = await fetch('https://api.tap.company/v2/charges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.tap.secretKey}`,
      },
      body: JSON.stringify({
        amount: Number(order.total),
        currency: 'SAR',
        reference: { order: order.order_code },
        source: { id: 'src_all' },
        redirect: { url: `${(process.env.CORS_ORIGINS || '').split(',')[0] || ''}/food/track/${order.order_code}` },
        post: { url: `${process.env.PUBLIC_API_BASE || ''}/api/food/webhooks/tap` },
      }),
    });
    const charge = await response.json();
    if (!response.ok || !charge.transaction || !charge.transaction.url) {
      console.error('createTapCharge gateway error:', charge);
      return res.status(502).json({ error: 'Could not start the Tap payment' });
    }

    await supabase.from('orders').update({ payment_method: 'tap' }).eq('id', order.id);
    return res.status(201).json({ orderCode: order.order_code, url: charge.transaction.url });
  } catch (err) {
    console.error('createTapCharge error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function tapWebhook(req, res) {
  try {
    // Tap is a deferred/placeholder path. With no gateway configured, NO
    // legitimate Tap webhook can arrive — so reject rather than trust an
    // unsigned request. (Otherwise an unsigned "CAPTURED" POST with a known
    // order code would mark that order paid, bypassing payment.) Mirrors
    // createTapCharge's 503 while TAP_* is unset.
    if (!config.tap.webhookSecret) {
      return res.status(503).json({ error: 'Tap Payments is not configured' });
    }
    // The signed webhook is the source of truth for Tap payments.
    {
      const signature = req.get('hashstring') || '';
      const payload = JSON.stringify(req.body || {});
      const expected = crypto
        .createHmac('sha256', config.tap.webhookSecret)
        .update(payload)
        .digest('hex');
      if (!signature || signature !== expected) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const charge = req.body || {};
    const orderCode = charge.reference && charge.reference.order;
    if (!orderCode || !charge.id) return res.status(400).json({ error: 'Malformed webhook' });

    const order = await loadOrder(orderCode);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (charge.status === 'CAPTURED') {
      // markOrderPaid dedupes by transaction id -> replayed webhooks are no-ops.
      await markOrderPaid(order, {
        provider: 'tap',
        transactionId: charge.id,
        raw: { status: charge.status, id: charge.id }, // never the card object
      });
    } else if (['FAILED', 'DECLINED', 'CANCELLED'].includes(charge.status)) {
      await supabase.from('orders').update({ payment_status: 'failed' }).eq('id', order.id)
        .eq('payment_status', 'awaiting');
      pushFoodOrderStatus(order.order_code, { paymentStatus: 'failed' });
    }
    return res.json({ received: true });
  } catch (err) {
    console.error('tapWebhook error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = {
  checkout,
  listOrders,
  getOrder,
  getPaymentInfo,
  createPayUploadUrl,
  recordPayment,
  createTapCharge,
  tapWebhook,
  markOrderPaid,
};
