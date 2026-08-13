// ---------------------------------------------------------------------
// "Start preparing" reminder sweep.
//
// An order stuck at 'pending' or 'accepted' means the kitchen never tapped
// "Start preparing", and the customer is waiting on a screen that will not
// move. Nothing used to chase that. This re-notifies the restaurant, the
// admins and the customer every config.food.preparingReminderMinutes until
// the order reaches 'preparing' — or until the cap, past which a human has
// to intervene rather than the platform nagging forever.
//
// The clock runs from created_at, not accepted_at, so an order the
// restaurant never even accepted is chased too.
//
// Bookkeeping lives on the order itself (migration 0037) rather than being
// derived from notification_events: one indexed predicate per pass instead
// of a per-order history count, and it gives us a CAS token for free.
// ---------------------------------------------------------------------
const { supabase } = require('./supabase');
const { config } = require('./config');
const { logNotification, notifyAdmins } = require('./notifications');
const { pushMerchantFeed, pingFoodAdmin } = require('./realtime');
const { logAudit } = require('./audit');

// Statuses that mean "the kitchen has not started". Anything further along
// the ladder — or cancelled/rejected — drops out of the sweep on its own.
const AWAITING_PREPARING = ['pending', 'accepted'];

// A prepaid order sitting at 'pending' with payment still 'awaiting' is
// blocked on the CUSTOMER paying (or an admin verifying an STC Pay proof),
// not on the kitchen. Nagging the restaurant about an abandoned checkout is
// noise it cannot act on. Cash is the exception: it stays 'awaiting' by
// design until the rider collects at the door, so those are real.
function blockedOnPayment(order) {
  return (
    order.status === 'pending' &&
    order.payment_status === 'awaiting' &&
    order.payment_method !== 'cash'
  );
}

async function sweepOrdersAwaitingPreparing() {
  const intervalMs = config.food.preparingReminderMinutes * 60 * 1000;
  const now = Date.now();
  const firstDueCutoff = new Date(now - intervalMs).toISOString();

  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, order_code, status, payment_status, payment_method, customer_id, merchant_id, ' +
        'created_at, preparing_reminder_count, preparing_reminder_last_at, ' +
        'merchants ( owner_id, name )'
    )
    .in('status', AWAITING_PREPARING)
    .lt('preparing_reminder_count', config.food.preparingReminderMaxCount)
    .lte('created_at', firstDueCutoff)
    // Due-ness has to be in the QUERY, not just the loop below. Filtering
    // after the limit lets a backlog of recently-reminded orders fill all 200
    // slots and starve the ones actually due — they would never be picked up.
    // last_at is null (never reminded, and created_at is already past the
    // cutoff) or itself a full interval old.
    .or(`preparing_reminder_last_at.is.null,preparing_reminder_last_at.lte.${firstDueCutoff}`)
    // Most overdue first, so the limit truncates the least urgent tail rather
    // than an arbitrary slice. Never-reminded orders sort ahead of the rest.
    .order('preparing_reminder_last_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    console.error('sweepOrdersAwaitingPreparing error:', error);
    return;
  }
  if (!data || data.length === 0) return;

  for (const order of data) {
    if (blockedOnPayment(order)) continue;

    // Due one full interval after the LAST reminder (or after checkout, for
    // the first). This is what makes it repeat rather than fire once.
    const since = order.preparing_reminder_last_at || order.created_at;
    if (Date.parse(since) + intervalMs > now) continue;

    // Claim the send before doing it, with a compare-and-swap on the count
    // we just read. Two overlapping passes — or a PM2 restart that starts a
    // second sweeper before the first interval settles — cannot both win, so
    // a reminder is never delivered twice.
    const attempt = order.preparing_reminder_count + 1;
    const { data: claimed, error: claimErr } = await supabase
      .from('orders')
      .update({
        preparing_reminder_count: attempt,
        preparing_reminder_last_at: new Date(now).toISOString(),
      })
      .eq('id', order.id)
      .eq('preparing_reminder_count', order.preparing_reminder_count)
      .eq('status', order.status)
      .select('order_code');
    if (claimErr) {
      console.error('sweepOrdersAwaitingPreparing claim error:', claimErr);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;

    const merchant = Array.isArray(order.merchants) ? order.merchants[0] : order.merchants;
    const waitedMinutes = Math.round((now - Date.parse(order.created_at)) / 60000);

    // Best-effort from here: the reminder is already claimed, so a delivery
    // hiccup must not abort the rest of the sweep.
    try {
      const alerts = [
        logNotification({
          userId: merchant ? merchant.owner_id : null,
          orderId: order.id,
          type: 'food_order_preparing_reminder',
          code: order.order_code,
          body:
            `Order ${order.order_code} has been waiting ${waitedMinutes} minutes. ` +
            'Tap "Start preparing" so the customer knows the kitchen began.',
          url: '/merchant',
        }),
        notifyAdmins({
          orderId: order.id,
          type: 'admin_food_order_preparing_overdue',
          code: order.order_code,
          body:
            `${(merchant && merchant.name) || 'A restaurant'} has not started order ` +
            `${order.order_code} after ${waitedMinutes} minutes (reminder ${attempt}).`,
          url: '/admin',
        }),
        logNotification({
          userId: order.customer_id,
          orderId: order.id,
          type: 'food_order_delayed',
          code: order.order_code,
          url: `/food/track/${order.order_code}`,
        }),
      ];
      await Promise.all(alerts);
    } catch (err) {
      console.error('sweepOrdersAwaitingPreparing notify error:', err.message || err);
    }

    logAudit({
      actorId: null,
      action: 'food_order_preparing_reminder',
      resourceType: 'order',
      resourceId: order.order_code,
      meta: { attempt, status: order.status, waited_minutes: waitedMinutes },
    });
    pushMerchantFeed(order.merchant_id, 'preparing_overdue', {
      orderCode: order.order_code,
      status: order.status,
      attempt,
      waitedMinutes,
    });
    pingFoodAdmin(order.order_code);
  }
}

module.exports = { sweepOrdersAwaitingPreparing };
