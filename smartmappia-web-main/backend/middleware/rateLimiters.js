// ---------------------------------------------------------------------
// Per-endpoint rate limiters (stricter than the global cap in app.js).
//
// These layer ON TOP of the global 120/min limiter, tightening specific
// high-risk endpoints (payment-proof upload, public code lookups, driver
// accept/location). All are IP-keyed (express-rate-limit default).
//
// PRODUCTION NOTE: behind a reverse proxy (Nginx on the VPS) set
//   app.set('trust proxy', 1)
// so the real client IP is used for keying — otherwise every request looks
// like it comes from the proxy and all users share a single bucket.
// ---------------------------------------------------------------------
const rateLimit = require('express-rate-limit');

const make = (max, message) =>
  rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Return JSON (not the default plain text) so the frontend shows a real
    // message instead of the bare "Request failed (429)" — api.js reads `.error`.
    message: { error: message || 'Too many requests — please slow down and try again shortly.' },
  });

module.exports = {
  // Payment-proof endpoints (code-gated, unauthenticated) — stop upload spam.
  proofLimiter: make(10),
  // Public code lookups (booking summary + tracking) — slow enumeration.
  lookupLimiter: make(60),
  // Driver accepting a ride — limit race/retry amplification.
  driverAcceptLimiter: make(20),
  // Driver location pings (~5/min in normal use) — headroom, block floods.
  // Logged (unlike the other limiters): a driver hitting 30/min on a 12s
  // ping cadence means something's wrong (retry storm, clock issue, shared
  // IP) and the failure is otherwise invisible — the frontend ping is silent
  // on purpose so it doesn't nag the driver every interval.
  locationLimiter: rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, _next, options) => {
      // Runs before requireApprovedDriver, so req.driverId isn't set yet.
      console.warn('[rate-limit] location ping blocked', { ip: req.ip });
      res.status(options.statusCode).json(options.message);
    },
    message: { error: 'Too many requests — please slow down and try again shortly.' },
  }),
  // OSM/Nominatim geocoding proxies. Split into per-endpoint buckets (they used
  // to SHARE one 40/min bucket, which the chatty location picker exhausted ->
  // the 429). Search is typed; reverse/nearby fire on map moves.
  locationSearchLimiter: make(60, 'You are searching too fast — please wait a moment.'),
  locationReverseLimiter: make(90, 'Too many location lookups — please wait a moment.'),
  locationNearbyLimiter: make(60, 'Too many map updates — please wait a moment.'),
  // OSRM routing proxy (map route lines). Generous — the client already only
  // refetches on ~100m movement; keeps routing off the location buckets.
  osrmLimiter: make(120, 'The map is updating quickly — it will catch up shortly.'),

  // --- Food Delivery ---
  // Restaurant browse/search — generous, but stops scraping floods.
  foodSearchLimiter: make(60),
  // Checkout (order creation) — a human places at most a few orders/minute.
  foodCheckoutLimiter: make(10),
  // Payment proof/charge endpoints — same posture as proofLimiter.
  foodPayLimiter: make(10),
  // Merchant accept/reject/status — limit race/retry amplification.
  merchantOrderLimiter: make(30),
  // Client analytics events — cheap writes, but cap the firehose.
  foodEventsLimiter: make(60),
};
