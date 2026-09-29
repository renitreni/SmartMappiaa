const express = require('express');
const { supabase } = require('../lib/supabase');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const PUBLIC_TOPIC = /^(booking-SM-[A-Za-z0-9-]+|fd-order-FD-[A-Za-z0-9-]+|shop-order-SH-[A-Za-z0-9-]+)$/;

async function authorize(req, topic) {
  if (PUBLIC_TOPIC.test(topic)) return true;
  const user = await authenticate(req);
  if (!user) return false;
  const { data: profile } = await supabase.from('profiles')
    .select('role,driver_approved').eq('id', user.id).maybeSingle();
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  if (topic === 'drivers-available') return profile.role === 'driver' && profile.driver_approved;
  if (topic === `driver-${user.id}`) return profile.role === 'driver';
  const merchant = topic.match(/^merchant-([0-9a-f-]{36})$/i);
  if (merchant && profile.role === 'merchant') {
    const { data } = await supabase.from('merchants').select('id')
      .eq('id', merchant[1]).eq('owner_id', user.id).maybeSingle();
    return !!data;
  }
  return false;
}

router.get('/', async (req, res) => {
  const topic = String(req.query.topic || '');
  try {
    if (!(await authorize(req, topic))) return res.status(403).json({ error: 'Event access denied' });
  } catch (err) {
    console.error('event authorization failed:', err);
    return res.status(503).json({ error: 'Live updates are temporarily unavailable' });
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('event: connected\ndata: {}\n\n');

  const channel = supabase.channel(topic)
    .on('broadcast', { event: '*' }, ({ event, payload }) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ event, payload })}\n\n`);
    });
  channel.subscribe((status) => {
    if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) && !res.writableEnded) {
      res.end('event: error\ndata: {}\n\n');
    }
  });
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 20000);
  req.on('close', () => {
    clearInterval(heartbeat);
    supabase.removeChannel(channel).catch(() => {});
  });
});

module.exports = router;
