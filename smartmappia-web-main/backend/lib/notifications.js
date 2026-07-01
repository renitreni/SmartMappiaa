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

// Record that a notification was (or would be) sent. Never throws — a logging
// failure must not break the request that triggered it.
async function logNotification({ userId = null, bookingId = null, type, channel = 'in_app' }) {
  try {
    await supabase.from('notification_events').insert({
      user_id: userId,
      booking_id: bookingId,
      type,
      channel,
      sent_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('logNotification error:', err.message || err);
  }
}

module.exports = { logNotification };
