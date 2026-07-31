// ---------------------------------------------------------------------
// Driver star ratings (Food Delivery + Pick & Drop).
//   - rateFoodDriver : POST /api/food/orders/:code/rate-driver
//   - rateRideDriver : POST /api/bookings/:code/rate-driver
//
// One rating per order/booking (DB unique), written only by the job's
// own customer, only after the job actually finished. Stars 1-5 with an
// optional comment.
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { logAudit } = require('../lib/audit');

async function insertRating(
  res,
  { driverId, customerId, orderId = null, bookingId = null, shopOrderId = null, stars, comment }
) {
  const { error } = await supabase.from('driver_ratings').insert({
    driver_id: driverId,
    customer_id: customerId,
    order_id: orderId,
    booking_id: bookingId,
    shop_order_id: shopOrderId,
    stars,
    comment: comment || null,
  });
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'You already rated this driver' });
    }
    console.error('insertRating error:', error);
    return res.status(500).json({ error: 'Could not save your rating' });
  }
  return res.status(201).json({ rated: true, stars });
}

async function rateFoodDriver(req, res) {
  try {
    const { data: order } = await supabase
      .from('orders')
      .select('id, order_code, customer_id, status')
      .eq('order_code', req.params.code)
      .maybeSingle();
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.customer_id !== req.userId) {
      return res.status(403).json({ error: 'This order belongs to another account' });
    }
    if (order.status !== 'delivered') {
      return res.status(409).json({ error: 'You can rate the rider once the order is delivered' });
    }

    const { data: delivery } = await supabase
      .from('deliveries')
      .select('driver_id')
      .eq('order_id', order.id)
      .maybeSingle();
    if (!delivery || !delivery.driver_id) {
      return res.status(409).json({ error: 'No rider was assigned to this order' });
    }

    logAudit({
      actorId: req.userId,
      action: 'driver_rated',
      resourceType: 'order',
      resourceId: order.order_code,
      meta: { stars: req.body.stars },
    });
    return insertRating(res, {
      driverId: delivery.driver_id,
      customerId: req.userId,
      orderId: order.id,
      stars: req.body.stars,
      comment: req.body.comment,
    });
  } catch (err) {
    console.error('rateFoodDriver error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function rateRideDriver(req, res) {
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_code, user_id, booking_status, assigned_driver_id')
      .eq('booking_code', req.params.code)
      .maybeSingle();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!booking.user_id || booking.user_id !== req.userId) {
      return res.status(403).json({ error: 'This booking belongs to another account' });
    }
    if (booking.booking_status !== 'completed') {
      return res.status(409).json({ error: 'You can rate the driver once the trip is completed' });
    }
    if (!booking.assigned_driver_id) {
      return res.status(409).json({ error: 'No driver was assigned to this booking' });
    }

    logAudit({
      actorId: req.userId,
      action: 'driver_rated',
      resourceType: 'booking',
      resourceId: booking.booking_code,
      meta: { stars: req.body.stars },
    });
    return insertRating(res, {
      driverId: booking.assigned_driver_id,
      customerId: req.userId,
      bookingId: booking.id,
      stars: req.body.stars,
      comment: req.body.comment,
    });
  } catch (err) {
    console.error('rateRideDriver error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function rateShopDriver(req, res) {
  try {
    const { data: order } = await supabase
      .from('shop_orders')
      .select('id, order_code, customer_id, status')
      .eq('order_code', req.params.code)
      .maybeSingle();
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.customer_id !== req.userId) {
      return res.status(403).json({ error: 'This order belongs to another account' });
    }
    if (order.status !== 'delivered') {
      return res.status(409).json({ error: 'You can rate the rider once the order is delivered' });
    }

    const { data: delivery } = await supabase
      .from('shop_deliveries')
      .select('driver_id')
      .eq('order_id', order.id)
      .maybeSingle();
    if (!delivery || !delivery.driver_id) {
      return res.status(409).json({ error: 'No rider was assigned to this order' });
    }

    logAudit({
      actorId: req.userId,
      action: 'driver_rated',
      resourceType: 'shop_order',
      resourceId: order.order_code,
      meta: { stars: req.body.stars },
    });
    return insertRating(res, {
      driverId: delivery.driver_id,
      customerId: req.userId,
      shopOrderId: order.id,
      stars: req.body.stars,
      comment: req.body.comment,
    });
  } catch (err) {
    console.error('rateShopDriver error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = { rateFoodDriver, rateRideDriver, rateShopDriver };
