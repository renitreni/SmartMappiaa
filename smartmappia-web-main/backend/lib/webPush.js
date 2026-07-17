const webpush = require('web-push');
const { supabase } = require('./supabase');

const publicKey = process.env.VAPID_PUBLIC_KEY || '';
const privateKey = process.env.VAPID_PRIVATE_KEY || '';
const subject = process.env.VAPID_SUBJECT || 'mailto:support@smartmappia.com';
const configured = Boolean(publicKey && privateKey);

if (configured) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

function getWebPushConfig() {
  return { enabled: configured, publicKey: configured ? publicKey : null };
}

async function removeExpiredSubscription(id) {
  const { error } = await supabase.from('device_push_tokens').delete().eq('id', id);
  if (error) console.error('removeExpiredSubscription error:', error.message || error);
}

async function sendWebPush(userId, payload) {
  if (!configured || !userId) return;

  const { data: tokens, error } = await supabase
    .from('device_push_tokens')
    .select('id, token')
    .eq('user_id', userId)
    .eq('platform', 'web');
  if (error) {
    console.error('sendWebPush token lookup error:', error.message || error);
    return;
  }

  await Promise.allSettled(
    (tokens || []).map(async ({ id, token }) => {
      try {
        const subscription = JSON.parse(token);
        await webpush.sendNotification(subscription, JSON.stringify(payload), {
          TTL: 60 * 60,
          urgency: 'high',
        });
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await removeExpiredSubscription(id);
          return;
        }
        console.error('sendWebPush delivery error:', err.message || err);
      }
    })
  );
}

module.exports = { getWebPushConfig, sendWebPush };
