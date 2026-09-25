// ---------------------------------------------------------------------
// Food Delivery — customer orders: checkout, payment, tracking, history
//   - checkout            : POST /api/food/orders
//   - listOrders          : GET  /api/food/orders
//   - getOrder            : GET  /api/food/orders/:code
//   - getPaymentInfo      : GET  /api/food/orders/:code/pay
//   - createPayUploadUrl  : POST /api/food/orders/:code/pay/signed-url
//   - recordPayment       : POST /api/food/orders/:code/pay
//   - createCardCharge    : POST /api/food/orders/:code/charge
//
// The Tap webhook is NOT here — one handler serves all three verticals at
// POST /api/payments/webhooks/tap (controllers/cardPaymentsController).
//
// HARD RULES enforced here (never client-side):
//   * money is recomputed from DB menu prices via lib/foodMoney.js —
//     any client-sent totals are ignored (the schema doesn't accept them)
//   * subtotal < 30 SAR  -> 422 { failure_reason: 'min_order' }
//   * outside the 15 km radius -> 422 { failure_reason: 'outside_radius' }
//   * only the gateway token / transaction id is stored, never card data
// ---------------------------------------------------------------------
const { supabase } = require('../../lib/supabase');
const { config } = require('../../lib/config');
const { chargeForOrder, respondToCharge } = require('../../lib/cardCharge');
const { confirmGatewayPayment } = require('../../lib/gatewayPaid');
const { haversineKm } = require('../../lib/geo');
const { travelEtaMinutes, deliveryEtaBand } = require('../../lib/eta');
const { latestDriverFix } = require('../../lib/tracking');
const { priceOrder } = require('../../lib/foodMoney');
const { getMaxDistanceKm, getStcPayEnabled } = require('../../lib/settings');
const { merchantOpenState, CLOSED_RESPONSE } = require('../../lib/storeHours');
const { findSizeOption } = require('../../lib/foodSizes');
const { logFoodEvent } = require('../../lib/foodEvents');
const { logAudit } = require('../../lib/audit');
const { logNotification, notifyAdmins } = require('../../lib/notifications');
const { pushFoodOrderStatus, pushMerchantFeed, pingFoodAdmin } = require('../../lib/realtime');
const { buildProofPath, createProofUploadUrl } = require('../../lib/storage');

// Payment statuses from which the customer may still (re)submit payment.
const PAYABLE_STATUSES = ['awaiting', 'failed'];

const ORDER_SELECT =
  'id, order_code, customer_id, merchant_id, status, subtotal, delivery_fee, delivery_surcharge, ' +
  'platform_margin_total, vat_amount, vat_rate, total, distance_km, delivery_address, delivery_lat, delivery_lng, ' +
  'delivery_street, delivery_building, ' +
  'contact_phone, payment_status, payment_method, created_at, accepted_at, ready_at, delivered_at, ' +
  'reject_reason, cancelled_by, cancelled_at';

// Statuses during which the customer may still edit their contact number.
const CONTACT_EDITABLE_STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

// Terminal states: the order is over, so there is nothing left to estimate.
// Quoting an ETA on a delivered or cancelled order would be noise, and it
// would also spend a Google Routes call on every poll of a dead page.
const ETA_IRRELEVANT_STATUSES = ['delivered', 'cancelled', 'rejected'];

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

    const { data: merchant, error: mErr } = await supabase
      .from('merchants')
      .select('id, name, vertical, is_active, status, accepting_orders, lat, lng, service_radius_km, owner_id')
      .eq('id', b.merchant_id)
      .maybeSingle();
    if (mErr) {
      console.error('checkout merchant load error:', mErr);
      return res.status(500).json({ error: 'Could not load the restaurant' });
    }
    // merchants is shared with the Ecommerce vertical (0026). Without the
    // vertical check a caller could pass a STORE id to food checkout: the
    // cart lookup would find nothing and it would fail as "empty cart", but
    // the failure would be confusing rather than correct.
    if (!merchant || merchant.vertical !== 'food' || !merchant.is_active || merchant.status !== 'active') {
      return res.status(409).json({
        error: 'This restaurant is not accepting orders right now',
        failure_reason: 'restaurant_unavailable',
      });
    }
    // Outside opening hours, or shut manually. Checked server-side because
    // the disabled button on the storefront is presentation, not a control.
    const openState = await merchantOpenState(merchant.id, merchant.accepting_orders);
    if (!openState.open) {
      return res.status(409).json({ ...CLOSED_RESPONSE, error: 'This restaurant is closed right now' });
    }
    // A restaurant with no map pin cannot take orders: the driver would have
    // no pickup point and the 15 km radius check below would be skipped
    // (distance is null), letting orders slip in from any distance. New
    // restaurants can no longer be listed unpinned, so this only guards
    // legacy rows until an admin re-pins them.
    if (!Number.isFinite(merchant.lat) || !Number.isFinite(merchant.lng)) {
      return res.status(422).json({
        error: 'This restaurant cannot take orders yet (location not set).',
        failure_reason: 'restaurant_location_missing',
      });
    }

    const { data: cart } = await supabase
      .from('carts')
      .select('id')
      .eq('customer_id', req.userId)
      .eq('merchant_id', merchant.id)
      .maybeSingle();
    const { data: cartLines } = cart
      ? await supabase
          .from('cart_items')
          .select('menu_item_id, quantity, size')
          .eq('cart_id', cart.id)
      : { data: [] };
    if (!cartLines || cartLines.length === 0) {
      return res.status(422).json({ error: 'Your cart is empty', failure_reason: 'empty_cart' });
    }

    // Re-read the LIVE menu rows — prices/margins come from here, not
    // from the cart snapshot and certainly not from the client.
    const { data: menuRows, error: menuErr } = await supabase
      .from('menu_items')
      .select('id, name, price, net_price, item_type, is_available, merchant_id, size_options')
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
      // A sized cart line must still map to an ENABLED size option — if the
      // admin disabled/removed that size since it was added, treat the line
      // as unavailable rather than silently charging the wrong price.
      const sizeOption = menu && line.size ? findSizeOption(menu.size_options, line.size) : null;
      if (!menu || !menu.is_available || menu.merchant_id !== merchant.id || (line.size && !sizeOption)) {
        unavailable.push(menu ? menu.name : 'a removed item');
      } else {
        items.push({
          menuItemId: menu.id,
          name: menu.name,
          size: sizeOption ? sizeOption.id : null,
          sizeLabel: sizeOption ? sizeOption.label : null,
          unitPrice: sizeOption ? Number(sizeOption.price) : Number(menu.price),
          netPrice: menu.net_price == null ? null : Number(menu.net_price),
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

    // Distance for the delivery-fee rule (merchant -> customer): flat fee
    // inside the free radius, + per-km surcharge beyond it, refused past
    // the max. Null when the restaurant has no pin yet — the flat promo
    // fee applies with no surcharge.
    const distanceKm = haversineKm(
      { lat: merchant.lat, lng: merchant.lng },
      { lat: b.delivery_lat, lng: b.delivery_lng }
    );

    // THE money math — single source of truth.
    const priced = priceOrder({ items, distanceKm, maxRadiusKm: await getMaxDistanceKm() });
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
          : `This address is ${priced.distanceKm} km away — beyond our ${priced.maxRadiusKm} km delivery limit.`;
      return res.status(422).json({ error: message, failure_reason: priced.failureReason, ...priced });
    }

    // Create the order (order_code comes from gen_order_code()).
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        customer_id: req.userId,
        merchant_id: merchant.id,
        subtotal: priced.subtotal,
        // delivery_fee is base + surcharge; the surcharge is stored beside it
        // so a reprinted receipt can itemise the distance charge (0034).
        delivery_fee: priced.deliveryFee,
        delivery_surcharge: priced.deliverySurcharge,
        // The driver's cut of that fee, snapshotted with the rate that
        // produced it (0041). Read back off the row at settlement, never
        // recomputed, so repricing the split cannot restate a delivery
        // already made or a cash balance already owed against it.
        driver_fee: priced.driverFee,
        driver_fee_rate: priced.driverFeeRate,
        platform_margin_total: priced.marginTotal,
        // VAT snapshot (migration 0025): the rate is stored alongside the
        // amount so a reprinted receipt shows what was actually charged.
        vat_amount: priced.vatAmount,
        vat_rate: priced.vatRate,
        total: priced.total,
        distance_km: distanceKm != null ? Math.round(distanceKm * 100) / 100 : null,
        delivery_address: b.delivery_address,
        delivery_lat: b.delivery_lat ?? null,
        delivery_lng: b.delivery_lng ?? null,
        delivery_street: b.delivery_street || null,
        delivery_building: b.delivery_building || null,
        contact_phone: b.contact_phone || null,
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
        size_snapshot: line.sizeLabel || null,
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

    // Clear the cart (cascade removes its lines).
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

    const creationAlerts = [
      logNotification({
        userId: req.userId,
        orderId: order.id,
        type: 'food_order_placed',
        code: order.order_code,
        title: 'Food order placed',
        body: `Your order from ${merchant.name} was created successfully.`,
        url: `/food/track/${order.order_code}`,
      }),
      notifyAdmins({
        orderId: order.id,
        type: 'admin_food_order_created',
        code: order.order_code,
        url: '/admin',
      }),
    ];
    if (merchant.owner_id) {
      creationAlerts.push(
        logNotification({
          userId: merchant.owner_id,
          orderId: order.id,
          type: 'merchant_food_order_created',
          code: order.order_code,
          title: 'New restaurant order',
          body: `A customer placed order ${order.order_code}.`,
          url: '/merchant',
        })
      );
    }
    await Promise.all(creationAlerts);

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

// PATCH /api/food/orders/:code/contact — the customer may fix their contact
// number even while the order is IN PROGRESS (out for delivery); the rider
// and admin views pick it up via broadcast + their normal refresh.
async function updateOrderContact(req, res) {
  try {
    const order = await loadOrder(req.params.code);
    if (!assertOwner(req, res, order)) return undefined;
    if (!CONTACT_EDITABLE_STATUSES.includes(order.status)) {
      return res.status(409).json({
        error: `The contact number can no longer be changed (order is ${order.status})`,
      });
    }

    const contactPhone = (req.body.contact_phone || '').trim();
    if (!contactPhone) return res.status(400).json({ error: 'contact_phone is required' });

    const { error } = await supabase
      .from('orders')
      .update({ contact_phone: contactPhone })
      .eq('id', order.id);
    if (error) {
      console.error('updateOrderContact error:', error);
      return res.status(500).json({ error: 'Could not update the contact number' });
    }

    logAudit({
      actorId: req.userId,
      action: 'food_order_contact_updated',
      resourceType: 'order',
      resourceId: order.order_code,
    });
    pushFoodOrderStatus(order.order_code, { contactPhone });
    pingFoodAdmin(order.order_code);

    return res.json({ orderCode: order.order_code, contactPhone });
  } catch (err) {
    console.error('updateOrderContact error:', err);
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
      // platform_margin_total stays internal: with variable markup it would
      // let the customer derive the restaurant's confidential net price.
      orders: (data || []).map(({ id, customer_id, platform_margin_total, ...order }) => order),
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
        .select('name_snapshot, size_snapshot, unit_price, quantity, line_total')
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
      // ~4s while online) + a rough ETA to the drop-off point. Only while
      // the delivery is actually active — otherwise a past customer could
      // keep polling this endpoint and track the rider's live position long
      // after their own order was delivered (mirrors the ride-tracking gate
      // in trackingController.js's ACTIVE_RIDE_STATUSES).
      //
      // latestDriverFix also drops a fix that is simply too old to trust, so
      // a rider who went offline mid-delivery stops rendering rather than
      // freezing on the map pretending to still be en route.
      if (['assigned', 'picked_up'].includes(delivery.status)) {
        const lastFix = await latestDriverFix(delivery.driver_id);
        if (lastFix) {
          rider.location = lastFix;
          // Real driving time, not haversine-over-30km/h. Before pickup the
          // rider is still heading to the RESTAURANT, so an ETA measured to
          // the customer's door would be nonsense while they drive the other
          // way — route to whichever leg they are actually on.
          const legTarget =
            delivery.status === 'picked_up'
              ? { lat: order.delivery_lat, lng: order.delivery_lng }
              : { lat: merchant?.lat, lng: merchant?.lng };
          rider.etaMinutes = await travelEtaMinutes(lastFix, legTarget);
          rider.leg = delivery.status === 'picked_up' ? 'to_customer' : 'to_restaurant';
        }
      }
    }

    // Headline ETA for the tracking hero, floored for the kitchen stage.
    // Once the rider has the food their live ETA is the honest number and
    // takes over; before that we measure the restaurant -> customer leg,
    // which is the part of the journey that has not started yet.
    const etaOrigin =
      rider && rider.leg === 'to_customer' && rider.location
        ? rider.location
        : { lat: merchant?.lat, lng: merchant?.lng };
    const eta = ETA_IRRELEVANT_STATUSES.includes(order.status)
      ? { min: null, max: null, label: null }
      : deliveryEtaBand(
          await travelEtaMinutes(etaOrigin, { lat: order.delivery_lat, lng: order.delivery_lng })
        );

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

    // platform_margin_total stays internal (net-price confidentiality).
    const { id, customer_id, platform_margin_total, ...publicOrder } = order;
    return res.json({ order: publicOrder, items: items || [], merchant: merchant || null, rider, eta, driverRating });
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

    const stcPayAvailable = await getStcPayEnabled();

    return res.json({
      orderCode: order.order_code,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method,
      amount: order.total,
      currency: 'SAR',
      // See the note in controllers/paymentsController.js - one switch (0044).
      stcPayAvailable,
      stcPay: stcPayAvailable
        ? {
            number: config.stcPay.number,
            recipientName: config.stcPay.recipientName,
          }
        : null,
      // The order code IS the transfer note so payments can be matched.
      reference: order.order_code,
      // Whether to offer the card option at all. Only the PUBLIC key is
      // ever sent — the secret is what gates availability server-side.
      cardAvailable: !!config.tap.secretKey,
      tapPublicKey: config.tap.publicKey || null,
      applePayEnabled: !!config.tap.applePayEnabled,
      instructions: stcPayAvailable
        ? [
            `Open STC Pay and send SAR ${Number(order.total).toFixed(2)} to ${config.stcPay.number} (${config.stcPay.recipientName}).`,
            `Put your order code ${order.order_code} in the transfer note.`,
            'Take a screenshot of the successful transfer.',
            'Upload that screenshot below to confirm your order.',
          ]
        : [],
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
      // 23505 = unique violation on gateway_transaction_id: the payment row
      // already exists. That does NOT mean the order caught up -- if the
      // process died between these two writes, the row is there and the
      // order is still 'awaiting'. Returning here made every one of Tap's
      // redeliveries take this same early exit, so the customer stayed
      // charged for an order nobody could see, forever. Re-run the order
      // update instead; it is idempotent and CAS-guarded on 'awaiting'.
      if (payErr.code === '23505') {
        await supabase
          .from('orders')
          .update({
            payment_status: 'paid',
            ...(transactionId != null ? { gateway_transaction_id: transactionId } : {}),
          })
          .eq('id', order.id)
          .eq('payment_status', 'awaiting');
        return { alreadyPaid: true };
      }
      throw payErr;
    }
    paymentId = payment.id;
  }

  // Check this error. supabase-js RESOLVES on a PostgREST failure rather
  // than rejecting, so an unchecked update returned normally, the webhook
  // answered 200, and Tap never retried -- money taken, order never
  // confirmed, nothing logged. Surfacing it makes the webhook answer
  // non-2xx, which is exactly the case where Tap's retry is the recovery.
  const { error: ordErr } = await supabase.from('orders').update({
    payment_status: 'paid',
    ...(transactionId != null ? { gateway_transaction_id: transactionId } : {}),
  }).eq('id', order.id);
  if (ordErr) {
    console.error('markOrderPaid: payment recorded but order update failed', order.order_code, ordErr);
    throw ordErr;
  }

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

// --- Payment: card via Tap (new card, saved card, or Apple Pay) --------
//
// The decision tree (which of Tap's save-card scenarios applies) lives in
// lib/cardCharge.js so all three verticals behave identically. This handler
// only loads the order, authorizes it, and maps the result onto HTTP.
async function createCardCharge(req, res) {
  try {
    const order = await loadOrder(req.params.code);
    if (!assertOwner(req, res, order)) return undefined;
    if (order.payment_method === 'cash') {
      return res.status(409).json({ error: 'This order is cash on delivery — pay the rider directly' });
    }
    if (!PAYABLE_STATUSES.includes(order.payment_status)) {
      return res.status(409).json({ error: `Payment is already ${order.payment_status}` });
    }
    // assertOwner lets admins through for support. Charging a card is the
    // one thing they must not do on someone else's behalf, so the card path
    // requires the real owner even when the caller is an admin.
    if (order.customer_id !== req.userId) {
      return res.status(403).json({ error: 'A card payment can only be made by the customer' });
    }

    const result = await chargeForOrder({
      req,
      profile: req.profile,
      vertical: 'food',
      code: order.order_code,
      amount: Number(order.total),
      redirectPath: `/food/track/${order.order_code}`,
      savedMethodId: req.body.saved_method_id || null,
      saveCard: req.body.save_card === true,
    });

    // Only claim the order for card once the gateway has accepted it.
    if (result.kind === 'redirect' || result.kind === 'paid') {
      await supabase.from('orders').update({ payment_method: 'tap' }).eq('id', order.id);
    }

    return respondToCharge(res, result, order.order_code, async () => {
      await confirmGatewayPayment({
        vertical: 'food',
        code: order.order_code,
        chargeId: result.chargeId,
        status: 'CAPTURED',
        amountPaid: result.charge && result.charge.amount,
        currency: result.charge && result.charge.currency,
      });
    }, 'food');
  } catch (err) {
    console.error('createCardCharge error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// NOTE: the per-vertical Tap webhook that used to live here is gone. It
// HMAC'd JSON.stringify(body), but Tap signs a concatenation of named
// charge fields keyed with the secret API key, so it could never have
// matched a real webhook. There is now one correct handler for all three
// verticals: POST /api/payments/webhooks/tap (controllers/cardPaymentsController).

module.exports = {
  checkout,
  listOrders,
  getOrder,
  getPaymentInfo,
  createPayUploadUrl,
  recordPayment,
  createCardCharge,
  markOrderPaid,
  updateOrderContact,
  loadOrder,
  PAYABLE_STATUSES,
};
