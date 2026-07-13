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
const { addTrackingEvent } = require('../lib/tracking');
const { logAudit } = require('../lib/audit');
const { logNotification } = require('../lib/notifications');
const { buildDriverDocPath, createProofUploadUrl } = require('../lib/storage');
const {
  pushBookingStatus,
  announceRequestTaken,
  pushFoodOrderStatus,
  pushMerchantFeed,
  pingFoodAdmin,
  broadcast,
} = require('../lib/realtime');
const { offerNext, loadFoodTarget, loadRideTarget, releaseFoodDelivery, releaseRide } = require('../lib/dispatch');

// Order statuses during which a rider can still be working the delivery.
const RIDER_ACTIVE_ORDER_STATUSES = ['accepted', 'preparing', 'ready', 'out_for_delivery'];

// --- Offers -------------------------------------------------------------

async function listOffers(req, res) {
  try {
    const nowIso = new Date().toISOString();
    const { data: offers, error } = await supabase
      .from('dispatch_offers')
      .select(
        'id, order_id, booking_id, distance_km, expires_at, ' +
          'orders ( order_code, total, delivery_address, merchants ( name, address ) ), ' +
          'bookings ( booking_code, trip_type, pickup_address, dropoff_address, fare_amount )'
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
        kind: o.order_id ? 'food' : 'ride',
        code: o.order_id ? o.orders?.order_code : o.bookings?.booking_code,
        distanceKm: o.distance_km,
        expiresAt: o.expires_at,
        secondsLeft: Math.max(0, Math.round((new Date(o.expires_at) - Date.now()) / 1000)),
        food: o.order_id && o.orders
          ? {
              merchantName: o.orders.merchants?.name || null,
              pickupAddress: o.orders.merchants?.address || null,
              dropoffAddress: o.orders.delivery_address,
              total: o.orders.total,
            }
          : null,
        ride: o.booking_id && o.bookings
          ? {
              tripType: o.bookings.trip_type,
              pickupAddress: o.bookings.pickup_address,
              dropoffAddress: o.bookings.dropoff_address,
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

// Claim the food delivery leg for a driver. Returns { ok } or { conflict }.
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

// Claim a Pick & Drop booking (same atomic update as the classic accept).
async function claimRide(bookingId, driverId) {
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
      .select('id, order_id, booking_id');
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

    const result = await claimRide(offer.booking_id, req.driverId);
    if (!result.ok) {
      await supabase.from('dispatch_offers').update({ status: 'cancelled' }).eq('id', offer.id);
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
      .select('id, order_id, booking_id');
    if (error) {
      console.error('declineOffer error:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
    if (!declined || declined.length === 0) {
      return res.status(409).json({ error: 'This offer is no longer pending' });
    }

    // Cascade to the next-nearest driver right away.
    const offer = declined[0];
    const target = offer.order_id
      ? await loadFoodTarget(offer.order_id)
      : await loadRideTarget(offer.booking_id);
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
  'delivery_address, delivery_lat, delivery_lng, created_at, ' +
  'merchants ( name, address, lat, lng ), ' +
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
      ? { name: o.merchants.name, address: o.merchants.address, lat: o.merchants.lat, lng: o.merchants.lng }
      : null,
    customer: o.profiles
      ? { name: o.profiles.full_name, mobile: o.profiles.mobile_number, whatsapp: o.profiles.whatsapp_number }
      : null,
    dropoffAddress: o.delivery_address,
    dropoffLat: o.delivery_lat,
    dropoffLng: o.delivery_lng,
    createdAt: o.created_at,
    deliveredAt: d.delivered_at,
  };
}

async function listMyDeliveries(req, res) {
  try {
    const { data, error } = await supabase
      .from('deliveries')
      .select(DELIVERY_SELECT)
      .eq('driver_id', req.driverId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) {
      console.error('listMyDeliveries error:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
    const deliveries = (data || []).map(shapeDelivery);
    return res.json({
      deliveries,
      active: deliveries.filter(
        (d) => RIDER_ACTIVE_ORDER_STATUSES.includes(d.orderStatus) && d.deliveryStatus !== 'delivered'
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
    const lat = req.query.lat != null ? Number(req.query.lat) : null;
    const lng = req.query.lng != null ? Number(req.query.lng) : null;
    const here = lat != null && lng != null ? { lat, lng } : null;

    const { data, error } = await supabase
      .from('deliveries')
      .select(DELIVERY_SELECT)
      .eq('status', 'open')
      .is('driver_id', null)
      .in('orders.status', ['accepted', 'preparing', 'ready'])
      .limit(50);
    if (error) {
      console.error('listOpenDeliveries error:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }

    const deliveries = (data || []).map((d) => {
      const shaped = shapeDelivery(d);
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
    const { data: order } = await supabase
      .from('orders')
      .select('id, order_code, status, merchant_id, customer_id')
      .eq('order_code', req.params.code)
      .maybeSingle();
    if (!order) return res.status(404).json({ error: 'Delivery not found' });

    const result = await claimFoodDelivery(
      { id: order.id, code: order.order_code, status: order.status, merchantId: order.merchant_id, customerId: order.customer_id },
      req.driverId
    );
    if (!result.ok) return res.status(409).json({ error: 'This delivery was already taken' });
    return res.json({ accepted: true, code: order.order_code });
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
    const { data: order } = await supabase
      .from('orders')
      .select('id, order_code, status')
      .eq('order_code', req.params.code)
      .maybeSingle();
    if (!order) return res.status(404).json({ error: 'Delivery not found' });

    const { data: delivery } = await supabase
      .from('deliveries')
      .select('id, driver_id, status')
      .eq('order_id', order.id)
      .maybeSingle();
    if (!delivery || delivery.driver_id !== req.driverId) {
      return res.status(403).json({ error: 'This delivery is not assigned to you' });
    }
    if (delivery.status !== 'assigned' || !['accepted', 'preparing', 'ready'].includes(order.status)) {
      return res.status(409).json({ error: 'You can only cancel before you pick up the order' });
    }

    const released = await releaseFoodDelivery(order.id, {
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
const DELIVERY_FLOW = {
  picked_up: {
    orderStatus: 'out_for_delivery',
    fromOrderStatuses: ['accepted', 'preparing', 'ready'],
    deliveryStatus: 'picked_up',
    photoColumn: 'pickup_photo_path',
    notify: 'food_order_out_for_delivery',
  },
  delivered: {
    orderStatus: 'delivered',
    fromOrderStatuses: ['out_for_delivery'],
    deliveryStatus: 'delivered',
    photoColumn: 'delivery_photo_path',
    notify: 'food_order_delivered',
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

    const { data: order } = await supabase
      .from('orders')
      .select('id, order_code')
      .eq('order_code', req.params.code)
      .maybeSingle();
    if (!order) return res.status(404).json({ error: 'Delivery not found' });

    const { data: delivery } = await supabase
      .from('deliveries')
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
    const photoPath = req.body.photo_path;
    if (!photoPath || !String(photoPath).startsWith(`${req.params.code}/`)) {
      return res.status(400).json({
        error: req.body.status === 'picked_up'
          ? 'Take a photo of the order at the restaurant first'
          : 'Take a photo of the delivered order first',
      });
    }

    const { data: order } = await supabase
      .from('orders')
      .select('id, order_code, status, merchant_id, customer_id, total, payment_status, payment_method')
      .eq('order_code', req.params.code)
      .maybeSingle();
    if (!order) return res.status(404).json({ error: 'Delivery not found' });

    const { data: delivery } = await supabase
      .from('deliveries')
      .select('id, driver_id')
      .eq('order_id', order.id)
      .maybeSingle();
    if (!delivery || delivery.driver_id !== req.driverId) {
      return res.status(403).json({ error: 'This delivery is not assigned to you' });
    }
    if (!flow.fromOrderStatuses.includes(order.status)) {
      return res.status(409).json({ error: `Cannot mark ${req.body.status} from "${order.status}"` });
    }

    const nowIso = new Date().toISOString();
    const patch = { status: flow.orderStatus };
    if (flow.orderStatus === 'delivered') patch.delivered_at = nowIso;
    const { data: rows, error } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', order.id)
      .eq('status', order.status)
      .select('order_code, status');
    if (error || !rows || rows.length === 0) {
      return res.status(409).json({ error: 'Order status changed — please refresh' });
    }

    await supabase
      .from('deliveries')
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
      order.payment_status !== 'paid'
    ) {
      const { markOrderPaid } = require('./food/ordersController');
      await markOrderPaid(order, {
        provider: 'cash',
        raw: { cash_collected_by: req.driverId },
        actorId: req.driverId,
      });
    }

    logAudit({
      actorId: req.driverId,
      action: `driver_delivery_${req.body.status}`,
      resourceType: 'order',
      resourceId: order.order_code,
      meta: { photo_path: photoPath },
    });
    pushFoodOrderStatus(order.order_code, { status: flow.orderStatus });
    pushMerchantFeed(order.merchant_id, 'order_update', { orderCode: order.order_code, status: flow.orderStatus });
    pingFoodAdmin(order.order_code);
    logNotification({ userId: order.customer_id, type: flow.notify, code: order.order_code });
    // A warm Thank You once the order is safely delivered (spec section 5).
    if (flow.orderStatus === 'delivered') {
      logNotification({ userId: order.customer_id, type: 'food_thank_you', code: order.order_code });
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
