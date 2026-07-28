const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

// GET /api/health -> confirms the server runs and can reach Supabase.
// Deliberately minimal: this endpoint is public, so it must not disclose
// internal configuration (payment/test mode) or raw error messages.
router.get('/', async (req, res) => {
  try {
    // Lightweight query just to confirm the DB connection works.
    const { error } = await supabase.from('bookings').select('id').limit(1);
    res.json({
      status: 'ok',
      db: error ? 'error' : 'connected',
      time: new Date().toISOString(),
    });
  } catch (err) {
    console.error('health check error:', err);
    res.status(500).json({ status: 'error' });
  }
});

module.exports = router;
