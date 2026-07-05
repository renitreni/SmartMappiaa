// ---------------------------------------------------------------------
// Food Delivery analytics events (PRD §9).
//
// One writer for fd_analytics_events so event names stay consistent
// (lowercase_with_underscores) whether the event comes from a server
// flow (checkout, accept, credit alerts) or from the client via
// POST /api/food/events. Best-effort: analytics must never break the
// request that produced them.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');

// The full PRD event vocabulary. Client-submitted events are restricted
// to the discovery/engagement subset below.
const FOOD_EVENTS = [
  'view_menu',
  'add_to_cart',
  'checkout_attempt',
  'payment_success',
  'merchant_order_accept',
  'credit_limit_warning',
  'service_suspended',
];

// Events a browser may report directly; everything else is server-observed.
const CLIENT_EVENTS = ['view_menu', 'add_to_cart', 'checkout_attempt'];

async function logFoodEvent({ eventName, userId = null, orderId = null, merchantId = null, params = null }) {
  try {
    if (!FOOD_EVENTS.includes(eventName)) {
      console.error(`logFoodEvent: unknown event "${eventName}" ignored`);
      return;
    }
    await supabase.from('fd_analytics_events').insert({
      event_name: eventName,
      user_id: userId,
      order_id: orderId,
      merchant_id: merchantId,
      params,
    });
  } catch (err) {
    console.error('logFoodEvent error:', err.message || err);
  }
}

module.exports = { FOOD_EVENTS, CLIENT_EVENTS, logFoodEvent };
