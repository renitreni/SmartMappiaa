// ---------------------------------------------------------------------
// /api/payments — the gateway webhook and the rides card charge.
//
// Food and shop keep their charge endpoints on their own routers (they need
// the vertical's own order loading); only the webhook is shared, because it
// must verify one signature the same way for all three.
// ---------------------------------------------------------------------
const express = require('express');

const { requireAuth } = require('../middleware/auth');
const { idempotent } = require('../middleware/idempotency');
const { validateBody } = require('../lib/validate');
const { cardChargeLimiter, webhookLimiter } = require('../middleware/rateLimiters');
const { tapWebhook, createBookingCardCharge } = require('../controllers/cardPaymentsController');

const router = express.Router();

// STATIC SEGMENT FIRST, and the charge route is /bookings/:code/... rather
// than the /:code/tap-charge shape the frontend used to call, precisely so
// "webhooks" can never be parsed as a booking code.
//
// Unauthenticated by necessity — Tap has no credential to present. The
// controls are the hashstring HMAC and a re-fetch of the charge from Tap
// before anything is marked paid.
router.post('/webhooks/tap', webhookLimiter, tapWebhook);

router.post(
  '/bookings/:code/charge',
  requireAuth,
  cardChargeLimiter,
  idempotent,
  validateBody({
    saved_method_id: { type: 'string', maxLength: 60, nullable: true },
    save_card: { type: 'boolean' },
  }),
  createBookingCardCharge
);

module.exports = router;
