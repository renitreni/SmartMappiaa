const express = require('express');
const router = express.Router();

// ---------------------------------------------------------------------
// OSRM proxy. The self-hosted OSRM container is bound to localhost:5000
// (never exposed publicly). The browser calls this same-origin under /api,
// so app.js's CORS allow-list applies and OSRM stays private. Path after
// /api/osrm is forwarded verbatim, e.g.
//   /api/osrm/route/v1/driving/LON,LAT;LON,LAT?overview=full&geometries=geojson
// ---------------------------------------------------------------------
const OSRM_URL = process.env.OSRM_URL || 'http://127.0.0.1:5000';

router.get('/*', async (req, res) => {
  const suffix = req.originalUrl.replace(/^\/api\/osrm/, '');
  try {
    const upstream = await fetch(`${OSRM_URL}${suffix}`);
    const body = await upstream.text();
    res.status(upstream.status).type('application/json').send(body);
  } catch (err) {
    console.error('osrm proxy error:', err.message || err);
    res.status(502).json({ error: 'Routing service unavailable' });
  }
});

module.exports = router;
