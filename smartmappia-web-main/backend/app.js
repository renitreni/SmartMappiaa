// ---------------------------------------------------------------------
// The Express application.
//
// We DEFINE the app here and export it, but we do NOT call app.listen()
// here. That lets the same app run two ways:
//   - server.js   -> normal long-running server on your machine
//   - api/index.js -> serverless function on Vercel
// ---------------------------------------------------------------------
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const bookingRoutes = require('./routes/bookings');
const trackingRoutes = require('./routes/tracking');
const adminRoutes = require('./routes/admin');
const driverRoutes = require('./routes/driver');
const notificationRoutes = require('./routes/notifications');

const app = express();

// Behind the Nginx reverse proxy on the VPS: trust the first proxy hop so the
// real client IP (X-Forwarded-For) is used for rate limiting, not the proxy's.
app.set('trust proxy', 1);

// Security headers. cross-origin RP so the separate frontend origin can read API responses.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS: restrict to CORS_ORIGINS (comma-separated) when set; otherwise allow all
// (fine for local/pilot). Set CORS_ORIGINS to the production frontend origin(s) before launch.
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));
app.use(express.json()); // parse JSON request bodies

// Rate limiting. Effective on a single server/VPS; on serverless it's best-effort
// per-instance. General cap on the whole API, stricter on auth to slow brute force.
const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/', generalLimiter);
app.use('/api/auth', authLimiter);

// --- Routes ---
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/notifications', notificationRoutes);

// Friendly root
app.get('/', (req, res) => {
  res.json({ name: 'Smart Mappia API', status: 'running' });
});

// 404 fallback for anything unmatched
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler — log the detail server-side, never leak stack traces
// or raw DB/internal errors to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: 'Unexpected server error' });
});

module.exports = app;
