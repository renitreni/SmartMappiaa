// ---------------------------------------------------------------------
// Driver dispatch controller (offers + food deliveries).
//   - listOffers          : GET  /api/driver/offers
//   - acceptOffer         : POST /api/driver/offers/:id/accept
//   - declineOffer        : POST /api/driver/offers/:id/decline
//   - listMyDeliveries    : GET  /api/driver/deliveries
//   - listOpenDeliveries  : GET  /api/driver/deliveries/available
//   - claimOpenDelivery   : POST /api/driver/deliveries/:code/claim
//   - updateDeliveryStatus: POST /api/driver/deliveries/:code/status
//
// Accepting is DOUBLE-CLAIM SAFE at three layers: the pending-offer
// unique index, a compare-and-swap on the offer row, and a final
// compare-and-swap on the job itself (deliveries.driver_id /
// bookings.assigned_driver_id must still be null to win).
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { config } = require('../lib/config');
const { haversineKm, etaMinutes } = require('../lib/geo');
const { assertWithinGeofence } = require('../lib/geofence');
const { addTrackingEvent } = require('../lib/tracking');
const { logAudit } = require('../lib/audit');
const { logNotification } = require('../lib/notifications');
const { buildDriverDocPath, createProofUploadUrl } = require('../lib/storage');
const { isBlockedFromCash } = require('../lib/driverCash');
const {
  pushBookingStatus,
  announceRequestTaken,
  pushFoodOrderStatus,
  pushMerchantFeed,
  pingFoodAdmin,
  pushShopOrderStatus,
  pingShopAdmin,
  broadcast,
} = require('../lib/realtime');
const {
  offerNext,
  loadFoodTarget,
  loadShopTarget,
  loadRideTarget,
  releaseFoodDelivery,
  releaseShopDelivery,
  releaseRide,
} = require('../lib/dispatch');
const { hasService } = require('../lib/serviceTypes');

// Order statuses during which a rider can still be working the delivery.
const RIDER_ACTIVE_ORDER_STATUSES = ['accepted', 'preparing', 'ready', 'out_for_delivery'];

// --- Offers -------------------------------------------------------------

async function listOffers(req, res) {
  try {
    const nowIso = new Date().toISOString();
    const { data: offers, error } = await supabase
      .from('dispatch_offers')
      .select(
        'id, order_id, booking_id, shop_order_id, distance_km, expires_at, ' +
          'orders ( order_code, total, delivery_address, delivery_street, delivery_building, merchants ( name, address, street, building_number ) ), ' +
          'shop_orders ( order_code, total, delivery_address, delivery_street, delivery_building, merchants ( name, address, street, building_number ) ), ' +
          'bookings ( booking_code, trip_type, pickup_address, pickup_street, pickup_building, dropoff_address, dropoff_street, dropoff_building, fare_amount )'
      )
      .eq('driver_id', req.driverId)
      .eq('status', 'pending')
      .gt('expires_at', nowIso);
    if (error) {
      console.error('listOffers error:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }

    return res.json({
      offers: (offers || []).map((o) => ({
        id: o.id,
        // Three job kinds since 0028. Deriving this from order_id alone used
        // to label a shop offer as a 'ride' with code undefined.
        kind: o.order_id ? 'food' : o.shop_order_id ? 'shop' : 'ride',
        code: o.order_id
          ? o.orders?.order_code
          : o.shop_order_id
            ? o.shop_orders?.order_code
            : o.bookings?.booking_code,
        distanceKm: o.distance_km,
        expiresAt: o.expires_at,
        secondsLeft: Math.max(0, Math.round((new Date(o.expires_at) - Date.now()) / 1000)),
        food: o.order_id && o.orders
          ? {
              merchantName: o.orders.merchants?.name || null,
              pickupAddress: o.orders.merchants?.address || null,
              pickupStreet: o.orders.merchants?.street || null,
              pickupBuilding: o.orders.merchants?.building_number || null,
              dropoffAddress: o.orders.delivery_address,
              dropoffStreet: o.orders.delivery_street,
              dropoffBuilding: o.orders.delivery_building,
              total: o.orders.total,
            }
          : null,
        // Same shape as `food` on purpose — the rider UI renders one card
        // for both and only swaps the label.
        shop: o.shop_order_id && o.shop_orders
          ? {
              merchantName: o.shop_orders.merchants?.name || null,
              pickupAddress: o.shop_orders.merchants?.address || null,
              pickupStreet: o.shop_orders.merchants?.street || null,
              pickupBuilding: o.shop_orders.merchants?.building_number || null,
              dropoffAddress: o.shop_orders.delivery_address,
              dropoffStreet: o.shop_orders.delivery_street,
              dropoffBuilding: o.shop_orders.delivery_building,
              total: o.shop_orders.total,
            }
          : null,
        ride: o.booking_id && o.bookings
          ? {
              tripType: o.bookings.trip_type,
              pickupAddress: o.bookings.pickup_address,
              pickupStreet: o.bookings.pickup_street,
              pickupBuilding: o.bookings.pickup_building,
              dropoffAddress: o.bookings.dropoff_address,
              dropoffStreet: o.bookings.dropoff_street,
              dropoffBuilding: o.bookings.dropoff_building,
              fareAmount: o.bookings.fare_amount,
            }
          : null,
      })),
    });
  } catch (err) {
    console.error('listOffers error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Returns { ok } or { conflict } — conflict means another driver already claimed it.
async function claimFoodDelivery(order, driverId) {
  const { data: claimed, error } = await supabase
    .from('deliveries')
    .update({ driver_id: driverId, status: 'assigned' })
    .eq('order_id', order.id)
    .is('driver_id', null)
    .select('id');
  if (error) {
    console.error('claimFoodDelivery error:', error);
    return { ok: false };
  }
  if (!claimed || claimed.length === 0) return { ok: false, conflict: true };

  const { data: driver } = await supabase
    .from('profiles')
    .select('full_name, whatsapp_number, mobile_number')
    .eq('id', driverId)
    .single();

  pushFoodOrderStatus(order.code, {
    status: order.status,
    rider: driver
      ? { name: driver.full_name, whatsapp: driver.whatsapp_number, mobile: driver.mobile_number, status: 'assigned' }
      : { status: 'assigned' },
  });
  pushMerchantFeed(order.merchantId, 'order_update', { orderCode: order.code, riderAssigned: true });
  pingFoodAdmin(order.code);
  broadcast('drivers-available', 'delivery_taken', { orderCode: order.code });
  logNotification({ userId: order.customerId, type: 'food_rider_assigned', code: order.code });
  logAudit({
    actorId: driverId,
    action: 'driver_delivery_claimed',
    resourceType: 'order',
    resourceId: order.code,
  });
  return { ok: true };
}

// Claim a shop delivery. Same compare-and-swap as claimFoodDelivery: the
// update only lands while shop_deliveries.driver_id is still null, so two
// riders can never both win.
async function claimShopDelivery(order, driverId) {
  const { data: claimed, error } = await supabase
    .from('shop_deliveries')
    .update({ driver_id: driverId, status: 'assigned' })
    .eq('order_id', order.id)
    .is('driver_id', null)
    .select('id');
  if (error) {
    console.error('claimShopDelivery error:', error);
    return { ok: false };
  }
  if (!claimed || claimed.length === 0) return { ok: false, conflict: true };

  const { data: driver } = await supabase
    .from('profiles')
    .select('full_name, whatsapp_number, mobile_number')
    .eq('id', driverId)
    .single();

  pushShopOrderStatus(order.code, {
    status: order.status,
    rider: driver
      ? { name: driver.full_name, whatsapp: driver.whatsapp_number, mobile: driver.mobile_number, status: 'assigned' }
      : { status: 'assigned' },
  });
  pushMerchantFeed(order.merchantId, 'order_update', { orderCode: order.code, riderAssigned: true });
  pingShopAdmin(order.code);
  broadcast('drivers-available', 'delivery_taken', { kind: 'shop', orderCode: order.code });
  logNotification({ userId: order.customerId, type: 'shop_rider_assigned', code: order.code });
  logAudit({
    actorId: driverId,
    action: 'driver_shop_delivery_claimed',
    resourceType: 'shop_order',
    resourceId: order.code,
  });
  return { ok: true };
}

// Claim a Pick & Drop booking (same atomic update as the classic accept).
async function claimRide(bookingId, driverId) {
  // Hard block: a driver at/over their cash-owed cap cannot take a cash ride.
  // Checked before the claim so an over-cap driver never holds more of our
  // money (STC rides are unaffected).
  const { data: pay } = await supabase
    .from('bookings')
    .select('payment_method')
    .eq('id', bookingId)
    .maybeSingle();
  if (pay && pay.payment_method === 'cash') {
    const { data: drv } = await supabase
      .from('profiles')
      .select('cash_owed, cash_owed_limit')
      .eq('id', driverId)
      .single();
    if (drv && isBlockedFromCash(drv)) return { ok: false, blocked: true };
  }

  const { data: claimed, error } = await supabase
    .from('bookings')
    .update({
      assigned_driver_id: driverId,
      driver_ride_status: 'accepted',
      booking_status: 'driver_assigned',
    })
    .eq('id', bookingId)
    .is('assigned_driver_id', null)
    .select('id, booking_code, user_id');
  if (error || !claimed || claimed.length === 0) return { ok: false, conflict: true };

  const booking = claimed[0];
  const { data: driver } = await supabase
    .from('profiles')
    .select('full_name, whatsapp_number')
    .eq('id', driverId)
    .single();

  await addTrackingEvent(booking.id, {
    eventType: 'driver_accepted',
    title: 'Driver accepted',
    message: `${(driver && driver.full_name) || 'A driver'} accepted your trip and is on the way.`,
    createdByUserId: driverId,
  });
  pushBookingStatus(booking.booking_code, {
    bookingStatus: 'driver_assigned',
    driverRideStatus: 'accepted',
    driver: driver ? { name: driver.full_name, whatsapp: driver.whatsapp_number } : null,
  });
  announceRequestTaken(booking.booking_code);
  logNotification({
    userId: booking.user_id,
    bookingId: booking.id,
    type: 'ride_driver_accepted',
    code: booking.booking_code,
  });
  return { ok: true };
}

async function acceptOffer(req, res) {
  try {
    // CAS 1: take the offer while it is still pending and unexpired.
    const { data: taken, error } = await supabase
      .from('dispatch_offers')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('driver_id', req.driverId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .select('id, order_id, booking_id, shop_order_id');
    if (error) {
      console.error('acceptOffer error:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
    if (!taken || taken.length === 0) {
      return res.status(409).json({ error: 'This offer has expired or was withdrawn' });
    }
    const offer = taken[0];

    // CAS 2: claim the job itself.
    if (offer.order_id) {
      const { data: order } = await supabase
        .from('orders')
        .select('id, order_code, status, merchant_id, customer_id')
        .eq('id', offer.order_id)
        .single();
      const result = await claimFoodDelivery(
        { id: order.id, code: order.order_code, status: order.status, merchantId: order.merchant_id, customerId: order.customer_id },
        req.driverId
      );
      if (!result.ok) {
        await supabase.from('dispatch_offers').update({ status: 'cancelled' }).eq('id', offer.id);
        return res.status(409).json({ error: 'This delivery was already taken' });
      }
      return res.json({ accepted: true, kind: 'food', code: order.order_code });
    }

    if (offer.shop_order_id) {
      const { data: order } = await supabase
        .from('shop_orders')
        .select('id, order_code, status, merchant_id, customer_id')
        .eq('id', offer.shop_order_id)
        .single();
      const result = await claimShopDelivery(
        {
          id: order.id,
          code: order.order_code,
          status: order.status,
          merchantId: order.merchant_id,
          customerId: order.customer_id,
        },
        req.driverId
      );
      if (!result.ok) {
        await supabase.from('dispatch_offers').update({ status: 'cancelled' }).eq('id', offer.id);
        return res.status(409).json({ error: 'This delivery was already taken' });
      }
      return res.json({ accepted: true, kind: 'shop', code: order.order_code });
    }

    const result = await claimRide(offer.booking_id, req.driverId);
    if (!result.ok) {
      await supabase.from('dispatch_offers').update({ status: 'cancelled' }).eq('id', offer.id);
      if (result.blocked) {
        return res.status(403).json({
          error: 'Settle your outstanding cash with SmartMappia before taking new cash rides',
          failure_reason: 'cash_owed_limit_reached',
        });
      }
      return res.status(409).json({ error: 'This ride was already taken' });
    }
    const { data: booking } = await supabase
      .from('bookings').select('booking_code').eq('id', offer.booking_id).single();
    return res.json({ accepted: true, kind: 'ride', code: booking.booking_code });
  } catch (err) {
    console.error('acceptOffer error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function declineOffer(req, res) {
  try {
    const { data: declined, error } = await supabase
      .from('dispatch_offers')
      .update({ status: 'declined', responded_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('driver_id', req.driverId)
      .eq('status', 'pending')
      .select('id, order_id, booking_id, shop_order_id');
    if (error) {
      console.error('declineOffer error:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
    if (!declined || declined.length === 0) {
      return res.status(409).json({ error: 'This offer is no longer pending' });
    }

    // Cascade to the next-nearest driver right away.
    //
    // Resolving the target by kind matters more here than anywhere else: a
    // shop offer used to fall through to loadRideTarget(null), which returns
    // null, so offerNext did nothing. The offer was already flipped to
    // 'declined', and the sweeper only revives 'pending' rows — so a single
    // decline killed the cascade for that order permanently.
    const offer = declined[0];
    let target = null;
    if (offer.order_id) target = await loadFoodTarget(offer.order_id);
    else if (offer.shop_order_id) target = await loadShopTarget(offer.shop_order_id);
    else target = await loadRideTarget(offer.booking_id);
    offerNext(target); // fire-and-forget; failures fall back to the sweeper

    return res.json({ declined: true });
  } catch (err) {
    console.error('declineOffer error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- My deliveries -------------------------------------------------------

const DELIVERY_SELECT =
  'id, status, delivered_at, pickup_photo_path, delivery_photo_path, ' +
  'orders!inner ( order_code, status, payment_status, payment_method, total, delivery_fee, ' +
  'delivery_address, delivery_street, delivery_building, delivery_lat, delivery_lng, contact_phone, created_at, ' +
  'merchants ( name, address, street, building_number, lat, lng ), ' +
  'profiles!orders_customer_id_fkey ( full_name, mobile_number, whatsapp_number ) )';

function shapeDelivery(d) {
  const o = d.orders;
  return {
    orderCode: o.order_code,
    orderStatus: o.status,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method,
    // Cash on delivery: the rider must collect this amount at the door.
    collectCash: o.payment_method === 'cash' && o.payment_status !== 'paid' ? o.total : null,
    total: o.total,
    deliveryFee: o.delivery_fee,
    deliveryStatus: d.status,
    hasPickupPhoto: !!d.pickup_photo_path,
    merchant: o.merchants
      ? {
          name: o.merchants.name,
          address: o.merchants.address,
          street: o.merchants.street,
          buildingNumber: o.merchants.building_number,
          lat: o.merchants.lat,
          lng: o.merchants.lng,
        }
      : null,
    // The order's own contact number (editable mid-delivery) wins over the
    // profile's stored one, so the rider always calls the current number.
    customer: o.profiles
      ? {
          name: o.profiles.full_name,
          mobile: o.contact_phone || o.profiles.mobile_number,
          whatsapp: o.profiles.whatsapp_number,
        }
      : o.contact_phone
        ? { name: null, mobile: o.contact_phone, whatsapp: null }
        : null,
    dropoffAddress: o.delivery_address,
    dropoffStreet: o.delivery_street,
    dropoffBuilding: o.delivery_building,
    dropoffLat: o.delivery_lat,
    dropoffLng: o.delivery_lng,
    createdAt: o.created_at,
    deliveredAt: d.delivered_at,
  };
}

// The shop equivalent of DELIVERY_SELECT. Same columns, different tables.
//
// Written out rather than derived from DELIVERY_SELECT by string replace:
// the customer embed carries an explicit FOREIGN KEY hint
// (profiles!<constraint>_customer_id_fkey), and that constraint name differs
// per table. A naive replace of just "orders!inner" leaves the food FK name
// behind and PostgREST rejects the whole query.
const SHOP_DELIVERY_SELECT =
  'id, status, delivered_at, pickup_photo_path, delivery_photo_path, ' +
  'shop_orders!inner ( order_code, status, payment_status, payment_method, total, delivery_fee, ' +
  'delivery_address, delivery_street, delivery_building, delivery_lat, delivery_lng, contact_phone, created_at, ' +
  'merchants ( name, address, street, building_number, lat, lng ), ' +
  'profiles!shop_orders_customer_id_fkey ( full_name, mobile_number, whatsapp_number ) )';

async function listMyDeliveries(req, res) {
  try {
    // Both verticals in one feed. The rider works a single queue; which
    // table a job came from is an implementation detail to them, so `kind`
    // is the only thing that distinguishes the cards.
    const [food, shop] = await Promise.all([
      supabase
        .from('deliveries')
        .select(DELIVERY_SELECT)
        .eq('driver_id', req.driverId)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('shop_deliveries')
        .select(SHOP_DELIVERY_SELECT)
        .eq('driver_id', req.driverId)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    if (food.error) {
      console.error('listMyDeliveries (food) error:', food.error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
    // A shop failure must not blank out the rider's food queue — the shop
    // tables may not exist yet on an environment that has not run 0026-0029.
    if (shop.error) console.error('listMyDeliveries (shop) error:', shop.error);

    const deliveries = [
      ...(food.data || []).map((d) => ({ ...shapeDelivery(d), kind: 'food' })),
      ...(shop.data || []).map((d) => ({ ...shapeDelivery({ ...d, orders: d.shop_orders }), kind: 'shop' })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({
      deliveries,
      active: deliveries.filter(
        (d) =>
          VERTICALS[d.kind].prePickupStatuses.concat('out_for_delivery').includes(d.orderStatus) &&
          d.deliveryStatus !== 'delivered'
      ),
    });
  } catch (err) {
    console.error('listMyDeliveries error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Open pool: deliveries every driver may claim (cascade exhausted).
async function listOpenDeliveries(req, res) {
  try {
    // A rider sees only the pools they opted into. Turning a vertical off
    // yields an empty list rather than a 403 — the frontend polls this
    // silently. Admin preview bypasses both gates.
    const isAdmin = req.role === 'admin';
    const wantsFood = isAdmin || hasService(req.profile, 'food');
    const wantsShop = isAdmin || hasService(req.profile, 'shop');
    if (!wantsFood && !wantsShop) return res.json({ deliveries: [] });

    const lat = req.query.lat != null ? Number(req.query.lat) : null;
    const lng = req.query.lng != null ? Number(req.query.lng) : null;
    const here = lat != null && lng != null ? { lat, lng } : null;

    const [food, shop] = await Promise.all([
      wantsFood
        ? supabase
            .from('deliveries')
            .select(DELIVERY_SELECT)
            .eq('status', 'open')
            .is('driver_id', null)
            .in('orders.status', VERTICALS.food.prePickupStatuses)
            .limit(50)
        : Promise.resolve({ data: [] }),
      wantsShop
        ? supabase
            .from('shop_deliveries')
            .select(SHOP_DELIVERY_SELECT)
            .eq('status', 'open')
            .is('driver_id', null)
            .in('shop_orders.status', VERTICALS.shop.prePickupStatuses)
            .limit(50)
        : Promise.resolve({ data: [] }),
    ]);
    if (food.error) {
      console.error('listOpenDeliveries (food) error:', food.error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
    if (shop.error) console.error('listOpenDeliveries (shop) error:', shop.error);

    const rows = [
      ...(food.data || []).map((d) => ({ row: d, kind: 'food' })),
      ...(shop.data || []).map((d) => ({ row: { ...d, orders: d.shop_orders }, kind: 'shop' })),
    ];

    const deliveries = rows.map(({ row, kind }) => {
      const shaped = { ...shapeDelivery(row), kind };
      const from = shaped.merchant && shaped.merchant.lat != null
        ? { lat: shaped.merchant.lat, lng: shaped.merchant.lng }
        : null;
      const distanceKm = here && from ? haversineKm(here, from) : null;
      return {
        ...shaped,
        distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
        etaMinutes: etaMinutes(distanceKm),
      };
    });
    deliveries.sort((a, b) => {
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });

    return res.json({ deliveries });
  } catch (err) {
    console.error('listOpenDeliveries error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function claimOpenDelivery(req, res) {
  try {
    const V = verticalForCode(req.params.code);
    if (req.role !== 'admin' && !hasService(req.profile, V.service)) {
      return res.status(403).json({
        error: `Enable ${V.label} in your services to claim these deliveries`,
      });
    }

    const { data: order } = await supabase
      .from(V.orderTable)
      .select('id, order_code, status, merchant_id, customer_id')
      .eq('order_code', req.params.code)
      .maybeSingle();
    if (!order) return res.status(404).json({ error: 'Delivery not found' });

    // The open POOL means status 'open'. Rows start life as 'searching'
    // during the exclusive cascade, and the claim helpers match only on
    // driver_id IS NULL — so without this a rider who knows an order code
    // could take a job out from under whoever currently holds the offer.
    // The filter cannot live in the helper: acceptOffer legitimately claims
    // a 'searching' row.
    const { data: deliveryRow } = await supabase
      .from(V.deliveryTable)
      .select('status')
      .eq('order_id', order.id)
      .maybeSingle();
    if (!deliveryRow || deliveryRow.status !== 'open') {
      return res.status(409).json({ error: 'This delivery is not in the open pool' });
    }

    const claim = V.key === 'shop' ? claimShopDelivery : claimFoodDelivery;
    const result = await claim(
      { id: order.id, code: order.order_code, status: order.status, merchantId: order.merchant_id, customerId: order.customer_id },
      req.driverId
    );
    if (!result.ok) return res.status(409).json({ error: 'This delivery was already taken' });
    return res.json({ accepted: true, kind: V.key, code: order.order_code });
  } catch (err) {
    console.error('claimOpenDelivery error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// POST /api/driver/deliveries/:code/cancel { reason? }
// A rider gives up a delivery they accepted but has NOT picked up yet. The order
// is released and instantly re-offered to the next-nearest driver (the canceller
// is excluded from the cascade). After pickup this is refused — the food is with
// the rider, so a support/admin path must handle it.
async function cancelDelivery(req, res) {
  try {
    const V = verticalForCode(req.params.code);
    const { data: order } = await supabase
      .from(V.orderTable)
      .select('id, order_code, status')
      .eq('order_code', req.params.code)
      .maybeSingle();
    if (!order) return res.status(404).json({ error: 'Delivery not found' });

    const { data: delivery } = await supabase
      .from(V.deliveryTable)
      .select('id, driver_id, status')
      .eq('order_id', order.id)
      .maybeSingle();
    if (!delivery || delivery.driver_id !== req.driverId) {
      return res.status(403).json({ error: 'This delivery is not assigned to you' });
    }
    if (delivery.status !== 'assigned' || !V.prePickupStatuses.includes(order.status)) {
      return res.status(409).json({ error: 'You can only cancel before you pick up the order' });
    }

    const released = await V.release(order.id, {
      previousDriverId: req.driverId,
      reason: req.body.reason || null,
      cause: 'cancelled',
      actorId: req.driverId,
    });
    if (!released) {
      return res.status(409).json({ error: 'This delivery can no longer be cancelled' });
    }
    return res.json({ cancelled: true, code: order.order_code });
  } catch (err) {
    console.error('cancelDelivery error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// POST /api/driver/rides/:code/cancel { reason? }
// A driver gives up a Pick & Drop ride they accepted but has NOT started yet.
// The booking is released back to 'confirmed' and re-offered to the next-nearest
// driver (unlike the terminal 'cancelled' status, the passenger keeps their
// trip). Once the trip has started this is refused.
async function cancelRide(req, res) {
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_code, assigned_driver_id, driver_ride_status')
      .eq('booking_code', req.params.code)
      .maybeSingle();
    if (!booking) return res.status(404).json({ error: 'Ride not found' });
    if (booking.assigned_driver_id !== req.driverId) {
      return res.status(403).json({ error: 'This ride is not assigned to you' });
    }
    if (!['accepted', 'on_the_way', 'arrived'].includes(booking.driver_ride_status)) {
      return res.status(409).json({ error: 'You can only cancel before the trip starts' });
    }

    const released = await releaseRide(booking.id, {
      previousDriverId: req.driverId,
      reason: req.body.reason || null,
      cause: 'cancelled',
      actorId: req.driverId,
    });
    if (!released) {
      return res.status(409).json({ error: 'This ride can no longer be cancelled' });
    }
    return res.json({ cancelled: true, code: booking.booking_code });
  } catch (err) {
    console.error('cancelRide error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// --- Delivery lifecycle (rider side) ---------------------------------------
// PHOTO PROOF IS MANDATORY at both steps (Grab-style accountability):
// picked_up -> photo of the order AT THE RESTAURANT, then the customer sees
//              "on the way"                     (order: out_for_delivery)
// delivered -> photo of the handover at the door (order: delivered; a cash
//              order records the collected payment here)
// Everything that differs between a food delivery and a shop delivery, in
// one place. The rider-side flow is otherwise identical: exclusive offer,
// claim, photo at pickup, photo at handover, cash collected at the door.
//
// The vertical is resolved from the ORDER CODE PREFIX (FD- vs SH-), which is
// the only thing the rider's URL carries. Codes are generated by
// gen_order_code() / gen_shop_order_code() and are unique per table.
const VERTICALS = {
  food: {
    key: 'food',
    orderTable: 'orders',
    deliveryTable: 'deliveries',
    service: 'food',
    label: 'Food delivery',
    pickupLabel: 'restaurant',
    // Order statuses from which a rider may still mark picked_up.
    prePickupStatuses: ['accepted', 'preparing', 'ready'],
    auditResource: 'order',
    notify: {
      picked_up: 'food_order_out_for_delivery',
      delivered: 'food_order_delivered',
      thanks: 'food_thank_you',
    },
    pushStatus: (...a) => pushFoodOrderStatus(...a),
    pingAdmin: (...a) => pingFoodAdmin(...a),
    release: (...a) => releaseFoodDelivery(...a),
    markPaid: (order, opts) => require('./food/ordersController').markOrderPaid(order, opts),
  },
  shop: {
    key: 'shop',
    orderTable: 'shop_orders',
    deliveryTable: 'shop_deliveries',
    service: 'shop',
    label: 'Store delivery',
    pickupLabel: 'store',
    // 'packing' replaces food's 'preparing'.
    prePickupStatuses: ['accepted', 'packing', 'ready'],
    auditResource: 'shop_order',
    notify: {
      picked_up: 'shop_order_out_for_delivery',
      delivered: 'shop_order_delivered',
      thanks: null, // shop_order_delivered already carries the thank-you
    },
    pushStatus: (...a) => pushShopOrderStatus(...a),
    pingAdmin: (...a) => pingShopAdmin(...a),
    release: (...a) => releaseShopDelivery(...a),
    markPaid: (order, opts) => require('./shop/ordersController').markShopOrderPaid(order, opts),
  },
};

function verticalForCode(code) {
  return String(code || '').toUpperCase().startsWith('SH-') ? VERTICALS.shop : VERTICALS.food;
}

const DELIVERY_FLOW = {
  picked_up: {
    orderStatus: 'out_for_delivery',
    deliveryStatus: 'picked_up',
    photoColumn: 'pickup_photo_path',
  },
  delivered: {
    orderStatus: 'delivered',
    deliveryStatus: 'delivered',
    photoColumn: 'delivery_photo_path',
  },
};

// POST /api/driver/deliveries/:code/photo-url { kind, file_name, mime_type }
// Signed upload URL for the mandatory proof photo (private proofs bucket,
// path <ORDER-CODE>/pickup-... or <ORDER-CODE>/delivery-...).
async function createDeliveryPhotoUrl(req, res) {
  try {
    const { kind, file_name, mime_type } = req.body;
    if (!mime_type || !config.proofs.allowedMimeTypes.includes(mime_type)) {
      return res.status(400).json({
        error: `mime_type is required and must be one of: ${config.proofs.allowedMimeTypes.join(', ')}`,
      });
    }

    const V = verticalForCode(req.params.code);
    const { data: order } = await supabase
      .from(V.orderTable)
      .select('id, order_code')
      .eq('order_code', req.params.code)
      .maybeSingle();
    if (!order) return res.status(404).json({ error: 'Delivery not found' });

    const { data: delivery } = await supabase
      .from(V.deliveryTable)
      .select('driver_id')
      .eq('order_id', order.id)
      .maybeSingle();
    if (!delivery || delivery.driver_id !== req.driverId) {
      return res.status(403).json({ error: 'This delivery is not assigned to you' });
    }

    const path = buildDriverDocPath(order.order_code, kind, file_name);
    const { token, signedUrl } = await createProofUploadUrl(path);
    return res.status(201).json({
      bucket: config.proofs.bucket,
      path,
      token,
      signedUrl,
      maxBytes: config.proofs.maxBytes,
    });
  } catch (err) {
    console.error('createDeliveryPhotoUrl error:', err);
    return res.status(500).json({ error: 'Could not create upload URL' });
  }
}

async function updateDeliveryStatus(req, res) {
  try {
    const flow = DELIVERY_FLOW[req.body.status];
    if (!flow) {
      return res.status(400).json({
        error: `status must be one of: ${Object.keys(DELIVERY_FLOW).join(', ')}`,
      });
    }
    // No photo, no status change — the proof is the whole point.
    const V = verticalForCode(req.params.code);
    const photoPath = req.body.photo_path;
    // Also rejects traversal: the key must sit directly under this order's
    // own folder, with no path segments of the caller's choosing.
    const pathOk =
      photoPath &&
      String(photoPath).startsWith(`${req.params.code}/`) &&
      !String(photoPath).includes('..') &&
      String(photoPath).split('/').length === 2;
    if (!pathOk) {
      return res.status(400).json({
        error: req.body.status === 'picked_up'
          ? `Take a photo of the order at the ${V.pickupLabel} first`
          : 'Take a photo of the delivered order first',
      });
    }

    // The shape check above proves the KEY is well-formed. It does not prove
    // anything was ever uploaded — a rider could post a made-up filename and
    // the order would advance with the store's dashboard showing a photo that
    // resolves to nothing. "Mandatory photo proof" has to mean the object
    // exists, so confirm it does before moving any money or status.
    const fileName = String(photoPath).split('/')[1];
    const { data: uploaded } = await supabase.storage
      .from(config.proofs.bucket)
      .list(req.params.code, { search: fileName, limit: 1 });
    if (!uploaded || uploaded.length === 0) {
      return res.status(400).json({
        error: 'The photo did not finish uploading — please try again.',
        failure_reason: 'photo_missing',
      });
    }

    const { data: order } = await supabase
      .from(V.orderTable)
      .select(
        'id, order_code, status, merchant_id, customer_id, total, payment_status, payment_method, ' +
          'delivery_lat, delivery_lng, merchants ( lat, lng )'
      )
      .eq('order_code', req.params.code)
      .maybeSingle();
    if (!order) return res.status(404).json({ error: 'Delivery not found' });

    const { data: delivery } = await supabase
      .from(V.deliveryTable)
      .select('id, driver_id')
      .eq('order_id', order.id)
      .maybeSingle();
    if (!delivery || delivery.driver_id !== req.driverId) {
      return res.status(403).json({ error: 'This delivery is not assigned to you' });
    }
    const fromStatuses =
      req.body.status === 'picked_up' ? V.prePickupStatuses : ['out_for_delivery'];
    if (!fromStatuses.includes(order.status)) {
      return res.status(409).json({ error: `Cannot mark ${req.body.status} from "${order.status}"` });
    }

    // Previously a fully trusted, unchecked client claim — a driver could
    // mark picked_up/delivered from anywhere. picked_up checks against the
    // restaurant; delivered checks against the drop-off address.
    const geofenceTarget = req.body.status === 'picked_up' ? order.merchants : { lat: order.delivery_lat, lng: order.delivery_lng };
    const geofenceError = await assertWithinGeofence({
      driverId: req.driverId,
      target: geofenceTarget,
      radiusMeters: config.geofence.defaultRadiusMeters,
      bodyLat: Number(req.body && req.body.lat),
      bodyLng: Number(req.body && req.body.lng),
    });
    if (geofenceError) return res.status(geofenceError.httpStatus).json(geofenceError.body);

    const nowIso = new Date().toISOString();
    const patch = { status: flow.orderStatus };
    if (flow.orderStatus === 'delivered') patch.delivered_at = nowIso;
    const { data: rows, error } = await supabase
      .from(V.orderTable)
      .update(patch)
      .eq('id', order.id)
      .eq('status', order.status)
      .select('order_code, status');
    if (error || !rows || rows.length === 0) {
      return res.status(409).json({ error: 'Order status changed — please refresh' });
    }

    await supabase
      .from(V.deliveryTable)
      .update({
        status: flow.deliveryStatus,
        [flow.photoColumn]: photoPath,
        ...(flow.deliveryStatus === 'picked_up' ? { picked_up_at: nowIso } : {}),
        ...(flow.deliveryStatus === 'delivered' ? { delivered_at: nowIso } : {}),
      })
      .eq('id', delivery.id);

    // Cash on delivery: handing the order over means the rider collected the
    // money — record the payment (idempotent inside markOrderPaid).
    if (
      flow.orderStatus === 'delivered' &&
      order.payment_method === 'cash' &&
      // 'awaiting', not '!== paid': the latter also matches 'refunded', and
      // the cash-once unique index is partial on status='paid', so a refunded
      // order would accept a second cash row and flip back to paid.
      order.payment_status === 'awaiting'
    ) {
      await V.markPaid(
        { ...order, status: flow.orderStatus },
        { provider: 'cash', raw: { cash_collected_by: req.driverId }, actorId: req.driverId }
      );
    }

    logAudit({
      actorId: req.driverId,
      action: `driver_${V.key}_delivery_${req.body.status}`,
      resourceType: V.auditResource,
      resourceId: order.order_code,
      meta: { photo_path: photoPath },
    });
    V.pushStatus(order.order_code, { status: flow.orderStatus });
    pushMerchantFeed(order.merchant_id, 'order_update', { orderCode: order.order_code, status: flow.orderStatus });
    V.pingAdmin(order.order_code);
    logNotification({ userId: order.customer_id, type: V.notify[req.body.status], code: order.order_code });
    // A warm Thank You once the order is safely delivered (spec section 5).
    if (flow.orderStatus === 'delivered' && V.notify.thanks) {
      logNotification({ userId: order.customer_id, type: V.notify.thanks, code: order.order_code });
    }

    return res.json({ orderCode: order.order_code, status: flow.orderStatus });
  } catch (err) {
    console.error('updateDeliveryStatus error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = {
  listOffers,
  acceptOffer,
  declineOffer,
  listMyDeliveries,
  listOpenDeliveries,
  claimOpenDelivery,
  cancelDelivery,
  cancelRide,
  createDeliveryPhotoUrl,
  updateDeliveryStatus,
};
