// ---------------------------------------------------------------------
// Notification helpers.
//
// Native push DELIVERY (Firebase Cloud Messaging) is added once the
// Capacitor APK exists — it needs an FCM server key + registered device
// tokens. Until then this module gives us:
//   - a place device tokens are collected (device_push_tokens), so delivery
//     drops in later with zero app changes, and
//   - logNotification(): a best-effort audit trail in notification_events.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { pushUserNotification } = require('./realtime');

// Record that a notification was (or would be) sent. Never throws — a logging
// failure must not break the request that triggered it.
//
// Besides the audit row it also broadcasts the new notification to the user's
// personal channel (user-<id>), so the in-app bell updates in real time. The
// optional `code` (booking/order code) lets the client deep-link the alert.
async function logNotification({ userId = null, bookingId = null, type, channel = 'in_app', code = null }) {
  try {
    const sentAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('notification_events')
      .insert({
        user_id: userId,
        booking_id: bookingId,
        type,
        channel,
        sent_at: sentAt,
      })
      .select('id, type, booking_id, channel, sent_at, created_at')
      .single();
    if (error) throw error;

    // Best-effort live push to the owner's bell.
    pushUserNotification(userId, {
      id: data.id,
      type: data.type,
      code,
      channel: data.channel,
      sent_at: data.sent_at,
      created_at: data.created_at,
    });
  } catch (err) {
    console.error('logNotification error:', err.message || err);
  }
}

module.exports = { logNotification };
