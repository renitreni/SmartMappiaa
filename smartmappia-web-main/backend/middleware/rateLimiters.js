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

const make = (max) =>
  rateLimit({ windowMs: 60 * 1000, max, standardHeaders: true, legacyHeaders: false });

module.exports = {
  // Payment-proof endpoints (code-gated, unauthenticated) — stop upload spam.
  proofLimiter: make(10),
  // Public code lookups (booking summary + tracking) — slow enumeration.
  lookupLimiter: make(60),
  // Driver accepting a ride — limit race/retry amplification.
  driverAcceptLimiter: make(20),
  // Driver location pings (~5/min in normal use) — headroom, block floods.
  locationLimiter: make(30),
};
