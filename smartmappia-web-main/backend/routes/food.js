const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { optionalAuth } = require('../middleware/foodAuth');
const { idempotent } = require('../middleware/idempotency');
const { validateBody } = require('../lib/validate');
const {
  foodSearchLimiter,
  foodCheckoutLimiter,
  foodPayLimiter,
  foodEventsLimiter,
} = require('../middleware/rateLimiters');
const { listRestaurants, getRestaurant } = require('../controllers/food/restaurantsController');
const {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
} = require('../controllers/food/cartController');
const {
  checkout,
  listOrders,
  getOrder,
  getPaymentInfo,
  createPayUploadUrl,
  recordPayment,
  createTapCharge,
  tapWebhook,
} = require('../controllers/food/ordersController');
const { recordEvent } = require('../controllers/food/eventsController');
const { rateFoodDriver } = require('../controllers/ratingsController');

// --- Discovery (public; optionalAuth only tags analytics) ---
router.get('/restaurants', foodSearchLimiter, optionalAuth, listRestaurants);
router.get('/restaurants/:id', foodSearchLimiter, optionalAuth, getRestaurant);

// --- Cart (signed-in customers; server reads all prices itself) ---
router.get('/cart', requireAuth, getCart);
router.post(
  '/cart/items',
  requireAuth,
  validateBody({
    menu_item_id: { type: 'string', required: true, maxLength: 60 },
    quantity: { type: 'integer', min: 1, max: 50 },
  }),
  addCartItem
);
router.patch(
  '/cart/items/:id',
  requireAuth,
  validateBody({ quantity: { type: 'integer', required: true, min: 0, max: 50 } }),
  updateCartItem
);
router.delete('/cart/items/:id', requireAuth, removeCartItem);

// --- Checkout: the server recomputes ALL money from DB prices and
//     enforces the 30 SAR minimum + 15 km radius (422 on failure). ---
router.post(
  '/orders',
  requireAuth,
  foodCheckoutLimiter,
  idempotent,
  validateBody({
    merchant_id: { type: 'string', required: true, maxLength: 60 },
    delivery_address: { type: 'string', required: true, maxLength: 500 },
    delivery_lat: { type: 'number', required: true, min: -90, max: 90 },
    delivery_lng: { type: 'number', required: true, min: -180, max: 180 },
    // Food is STC Pay only for now. Tap arrives via the gated
    // /orders/:code/tap-charge endpoint, never as a checkout method.
    payment_method: { type: 'string', enum: ['stcpay'] },
  }),
  checkout
);

// --- Tracking + history ---
router.get('/orders', requireAuth, listOrders);
router.get('/orders/:code', requireAuth, getOrder);

// --- Payment (STC Pay manual proof; Tap deferred) ---
router.get('/orders/:code/pay', requireAuth, getPaymentInfo);
router.post(
  '/orders/:code/pay/signed-url',
  requireAuth,
  foodPayLimiter,
  validateBody({
    file_name: { type: 'string', maxLength: 255 },
    mime_type: { type: 'string', required: true, maxLength: 100 },
  }),
  createPayUploadUrl
);
router.post(
  '/orders/:code/pay',
  requireAuth,
  foodPayLimiter,
  idempotent,
  validateBody({
    path: { type: 'string', required: true, maxLength: 400 },
    file_name: { type: 'string', maxLength: 255 },
    mime_type: { type: 'string', maxLength: 100 },
    size_bytes: { type: 'integer', min: 0 },
    reference: { type: 'string', maxLength: 120 },
  }),
  recordPayment
);
router.post('/orders/:code/tap-charge', requireAuth, foodPayLimiter, createTapCharge);

// Rate the delivery rider (1-5 stars) after the order is delivered.
router.post(
  '/orders/:code/rate-driver',
  requireAuth,
  validateBody({
    stars: { type: 'integer', required: true, min: 1, max: 5 },
    comment: { type: 'string', maxLength: 500, nullable: true },
  }),
  rateFoodDriver
);

// Signed gateway webhook — the source of truth for Tap charges.
router.post('/webhooks/tap', tapWebhook);

// --- Client analytics events (anonymous allowed, whitelisted names) ---
router.post(
  '/events',
  foodEventsLimiter,
  optionalAuth,
  validateBody({
    event_name: { type: 'string', required: true, maxLength: 60 },
    merchant_id: { type: 'string', maxLength: 60 },
    order_id: { type: 'string', maxLength: 60 },
    params: { type: 'object', maxLength: 2000 },
  }),
  recordEvent
);

module.exports = router;
