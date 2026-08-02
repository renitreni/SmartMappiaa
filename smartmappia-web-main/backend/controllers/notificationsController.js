// ---------------------------------------------------------------------
// Notifications controller.
//   - registerToken      : POST   /api/notifications/register
//   - unregisterToken    : POST   /api/notifications/unregister
//   - listMyNotifications : GET    /api/notifications
//
// Collects device push tokens now so native FCM delivery (via the Capacitor
// APK) plugs in later with no client changes. All routes require a signed-in
// user; tokens are always scoped to req.userId.
// ---------------------------------------------------------------------
const { supabase } = require('../lib/supabase');
const { getWebPushConfig } = require('../lib/webPush');

const PLATFORMS = ['android', 'ios', 'web'];

async function registerToken(req, res) {
  try {
    const { token, platform, app_version } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token is required' });
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `platform must be one of: ${PLATFORMS.join(', ')}` });
    }
    // A browser subscription can only belong to the currently signed-in
    // account. This prevents a shared phone from receiving the previous
    // account's private alerts.
    const { error } = await supabase
      .from('device_push_tokens')
      .upsert(
        {
          user_id: req.userId,
          token,
          platform,
          app_version: app_version ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'token' }
      );
    if (error) {
      console.error('registerToken error:', error);
      return res.status(500).json({ error: 'Could not register device' });
    }
    return res.status(201).json({ registered: true });
  } catch (err) {
    console.error('registerToken error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

function pushConfig(_req, res) {
  return res.json(getWebPushConfig());
}

async function unregisterToken(req, res) {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token is required' });
    const { error } = await supabase
      .from('device_push_tokens')
      .delete()
      .eq('user_id', req.userId)
      .eq('token', token);
    if (error) {
      console.error('unregisterToken error:', error);
      return res.status(500).json({ error: 'Could not unregister device' });
    }
    return res.json({ unregistered: true });
  } catch (err) {
    console.error('unregisterToken error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function listMyNotifications(req, res) {
  try {
    const { data, error } = await supabase
      .from('notification_events')
      .select('id, type, channel, booking_id, order_id, code, read_at, sent_at, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      console.error('listMyNotifications error:', error);
      return res.status(500).json({ error: 'Unexpected server error' });
    }
    return res.json({ notifications: data });
  } catch (err) {
    console.error('listMyNotifications error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

async function markAllRead(req, res) {
  try {
    const readAt = new Date().toISOString();
    const { error } = await supabase
      .from('notification_events')
      .update({ read_at: readAt })
      .eq('user_id', req.userId)
      .is('read_at', null);
    if (error) {
      console.error('markAllRead error:', error);
      return res.status(500).json({ error: 'Could not update notifications' });
    }
    return res.json({ readAt });
  } catch (err) {
    console.error('markAllRead error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

module.exports = {
  pushConfig,
  registerToken,
  unregisterToken,
  listMyNotifications,
  markAllRead,
};
