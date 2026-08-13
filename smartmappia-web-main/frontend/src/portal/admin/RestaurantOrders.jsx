// ---------------------------------------------------------------------
// Admin "Restaurant Orders" tab.
//
// A live, per-restaurant view of what is currently on the pass, built for
// one question: which kitchens have not started cooking yet? Orders still
// at 'pending'/'accepted' past the reminder window are pulled to the top
// and flagged, mirroring the chase that backend/lib/foodPreparingReminder.js
// is running server-side.
//
// Deliberately narrower than the Food tab: no merchant CRUD, no menus, no
// settlement. Orders only.
//
// This is also the first admin screen that makes a sound. Merchants and
// riders have had the chime since the new-order broadcast landed; admins
// were watching a silently-reloading table.
// ---------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, ClipboardList, ChevronRight, Store, UtensilsCrossed } from 'lucide-react';
import { api } from '../lib/api';
import { useBroadcast } from '../lib/useBroadcast';
import { realtimeEnabled } from '../lib/supabaseClient';
import { fmtSAR, foodStatusMeta, foodPaymentMeta } from '../lib/constants';
import { announceNewOrder, playOrderAlert } from '../lib/orderAlert';
import { Card, Badge, Spinner, btnPrimary, btnGhost } from '../components/ui';
import SoundToggle from '../components/SoundToggle';

// Only used until the first response lands — GET /api/admin/food/orders
// returns the real config.food.preparingReminderMinutes, so the highlight
// tracks the window the server actually reminds on rather than drifting when
// FOOD_PREPARING_REMINDER_MINUTES is overridden.
const DEFAULT_REMINDER_MINUTES = 10;

// The ladder as far as this tab cares. Beyond 'preparing' the kitchen has
// done its part, so those orders are shown but never flagged.
const ON_THE_PASS = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
const NOT_STARTED = ['pending', 'accepted'];

// A prepaid order still awaiting payment is blocked on the customer, not the
// kitchen — same carve-out the sweeper makes, so the UI agrees with what the
// restaurant actually gets nagged about.
function blockedOnPayment(o) {
  return o.status === 'pending' && o.paymentStatus === 'awaiting' && o.paymentMethod !== 'cash';
}

function waitedMinutes(o, now) {
  return Math.max(0, Math.floor((now - new Date(o.createdAt).getTime()) / 60000));
}

function isOverdue(o, now, thresholdMinutes) {
  return (
    NOT_STARTED.includes(o.status) &&
    !blockedOnPayment(o) &&
    waitedMinutes(o, now) >= thresholdMinutes
  );
}

function humanWait(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

// pending -> accept it; accepted -> start preparing. The two actions an admin
// actually wants when a restaurant has gone quiet. Everything further along
// the ladder stays on the Food tab.
const NEXT_ACTION = {
  pending: { label: 'Accept for them', run: (code) => api.adminFoodAcceptOrder(code) },
  accepted: { label: 'Start preparing', run: (code) => api.adminFoodOrderStatus(code, 'preparing') },
};

export default function RestaurantOrders() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [busyCode, setBusyCode] = useState(null);
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  // Elapsed times are rendered from createdAt, so the view needs its own
  // heartbeat to keep counting between reloads.
  const [now, setNow] = useState(() => Date.now());
  const [reminderMinutes, setReminderMinutes] = useState(DEFAULT_REMINDER_MINUTES);
  // Order codes already chimed for on this page, so the 30 s heartbeat does
  // not re-ring the same backlog every tick.
  const seenOverdue = useRef(new Set());

  const load = useCallback(async () => {
    try {
      const res = await api.adminFoodOrders();
      setOrders((res.orders || []).filter((o) => ON_THE_PASS.includes(o.status)));
      if (Number.isFinite(res.preparingReminderMinutes)) {
        setReminderMinutes(res.preparingReminderMinutes);
      }
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const connected = useBroadcast(
    'admin-food',
    {
      changed: () => load(),
      // Server-side reminder just fired. Ring again rather than reusing the
      // plain order code, which announceNewOrder would have already spent on
      // the new-order chime.
      preparing_overdue: (payload) => {
        announceNewOrder(`${payload?.orderCode}#${payload?.attempt}`);
        load();
      },
    },
    realtimeEnabled
  );

  // Polling fallback for when Realtime is off or the socket drops, same as
  // every other broadcast consumer in the portal.
  useEffect(() => {
    if (connected) return undefined;
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [connected, load]);

  // Ring for anything that is already overdue when it first appears, so an
  // admin opening the tab mid-shift is not met with silence. ONE ring per
  // batch, not per order — a quiet shift can surface a dozen at once and
  // twelve overlapping chimes is noise, not an alert.
  useEffect(() => {
    if (!orders) return;
    const fresh = orders.filter(
      (o) => isOverdue(o, now, reminderMinutes) && !seenOverdue.current.has(o.orderCode)
    );
    if (fresh.length === 0) return;
    fresh.forEach((o) => seenOverdue.current.add(o.orderCode));
    playOrderAlert();
  }, [orders, now, reminderMinutes]);

  async function run(code, fn) {
    setBusyCode(code);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
      await load(); // e.g. a 403 credit block — show the true state
    } finally {
      setBusyCode(null);
    }
  }

  const groups = useMemo(() => {
    const visible = (orders || []).filter((o) =>
      onlyWaiting ? isOverdue(o, now, reminderMinutes) : true
    );
    const byRestaurant = new Map();
    for (const o of visible) {
      const name = o.merchantName || 'Unknown restaurant';
      if (!byRestaurant.has(name)) byRestaurant.set(name, []);
      byRestaurant.get(name).push(o);
    }
    for (const list of byRestaurant.values()) {
      // Oldest first inside a restaurant — the longest wait is the one to fix.
      list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }
    // Restaurants with overdue orders float to the top, then the busiest.
    return [...byRestaurant.entries()].sort((a, b) => {
      const aLate = a[1].filter((o) => isOverdue(o, now, reminderMinutes)).length;
      const bLate = b[1].filter((o) => isOverdue(o, now, reminderMinutes)).length;
      if (aLate !== bLate) return bLate - aLate;
      return b[1].length - a[1].length;
    });
  }, [orders, onlyWaiting, now, reminderMinutes]);

  const overdueCount = (orders || []).filter((o) => isOverdue(o, now, reminderMinutes)).length;

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
          {error}
        </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <button
          type="button"
          onClick={() => setOnlyWaiting((v) => !v)}
          className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors cursor-pointer ${
            onlyWaiting
              ? 'bg-brand-black text-white border-brand-black'
              : 'bg-white text-brand-grey border-brand-border'
          }`}
        >
          {onlyWaiting ? 'Showing waiting only' : 'Show waiting only'}
          {overdueCount > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-md bg-orange-500 text-white text-xs tabular-nums">
              {overdueCount}
            </span>
          )}
        </button>
        <span className="ml-auto"><SoundToggle /></span>
      </div>

      {overdueCount > 0 && (
        <Card className="p-4 border-orange-300 bg-orange-50">
          <div className="flex items-start gap-3">
            <AlarmClock className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-bold text-brand-dark text-sm">
                {overdueCount} order{overdueCount === 1 ? '' : 's'} waiting more than {reminderMinutes} minutes
              </p>
              <p className="text-xs text-brand-grey mt-0.5">
                The restaurant has been reminded automatically. Call them if it keeps climbing.
              </p>
            </div>
          </div>
        </Card>
      )}

      {orders === null && <div className="flex justify-center py-12"><Spinner className="!w-7 !h-7" /></div>}

      {orders !== null && groups.length === 0 && (
        <Card className="p-8 text-center">
          <ClipboardList className="w-8 h-8 text-brand-grey/40 mx-auto mb-2" />
          <p className="text-sm text-brand-grey">
            {onlyWaiting ? 'No restaurant is behind right now.' : 'No live restaurant orders.'}
          </p>
        </Card>
      )}

      {groups.map(([restaurant, list]) => {
        const late = list.filter((o) => isOverdue(o, now, reminderMinutes)).length;
        return (
          <Card key={restaurant} className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Store className="w-4 h-4 text-brand-grey shrink-0" />
                <p className="font-black text-brand-dark truncate">{restaurant}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {late > 0 && <Badge tone="amber">{late} waiting</Badge>}
                <Badge tone="grey">{list.length} live</Badge>
              </div>
            </div>

            <div className="space-y-2">
              {list.map((o) => {
                const status = foodStatusMeta(o.status);
                const pay = foodPaymentMeta(o.paymentStatus);
                const overdue = isOverdue(o, now, reminderMinutes);
                const mins = waitedMinutes(o, now);
                const action = NEXT_ACTION[o.status];
                const busy = busyCode === o.orderCode;
                return (
                  <div
                    key={o.orderCode}
                    className={`p-3 rounded-xl border ${
                      overdue ? 'border-orange-300 bg-orange-50' : 'border-brand-border bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-mono font-bold text-brand-dark">{o.orderCode}</p>
                        <p className="text-xs text-brand-grey truncate">
                          {o.customerName || 'Customer'} · {new Date(o.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {overdue && (
                          <Badge tone="amber">
                            <AlarmClock className="w-3 h-3 inline mr-1 -mt-0.5" />
                            Waiting {humanWait(mins)}
                          </Badge>
                        )}
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <Badge tone={pay.tone}>{pay.label}</Badge>
                        {o.paymentMethod === 'cash' && <Badge tone="grey">Cash</Badge>}
                        <span className="font-black text-brand-orange tabular-nums ml-1">{fmtSAR(o.total)}</span>
                      </div>
                    </div>

                    {(o.items || []).length > 0 && (
                      <p className="text-xs text-brand-grey mt-2 truncate">
                        <UtensilsCrossed className="w-3 h-3 inline mr-1 -mt-0.5" />
                        {o.items
                          .map((i) => `${i.quantity} × ${i.name_snapshot}${i.size_snapshot ? ` (${i.size_snapshot})` : ''}`)
                          .join(', ')}
                      </p>
                    )}

                    {blockedOnPayment(o) && (
                      <p className="text-xs text-brand-grey mt-2">
                        Waiting on the customer&apos;s payment — the kitchen is not being reminded for this one.
                      </p>
                    )}

                    {action && (
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(o.orderCode, () => action.run(o.orderCode))}
                          className={overdue ? btnPrimary : btnGhost}
                        >
                          {busy ? <Spinner className="!w-4 !h-4" /> : (
                            <>
                              {action.label}
                              <ChevronRight className="w-4 h-4" />
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
