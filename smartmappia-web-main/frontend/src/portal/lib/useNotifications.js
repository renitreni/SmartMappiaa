// ---------------------------------------------------------------------
// Notification inbox state for the signed-in user.
//
//   - loads history from GET /api/notifications
//   - receives user-scoped Web Push messages while open, with authenticated
//     polling as a safety net
//   - persists read state on the server (with localStorage as a compatibility
//     fallback until migration 0017 is applied everywhere)
//   - rings a chime + toast when a fresh notification lands
// ---------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { api } from './api';
import { notifyAlert } from './notify';
import { notificationMeta } from './notifications';

const SEEN_KEY = 'sm_notifications_seen_at';
const POLL_MS = 30000;

function loadSeenAt() {
  try {
    return localStorage.getItem(SEEN_KEY) || null;
  } catch {
    return null;
  }
}

export function useNotifications() {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [seenAt, setSeenAt] = useState(loadSeenAt);
  const [connected, setConnected] = useState(
    () => typeof Notification !== 'undefined' && Notification.permission === 'granted'
  );
  const knownIds = useRef(new Set());

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await api.listNotifications();
      const list = res?.notifications || [];
      knownIds.current = new Set(list.map((n) => n.id));
      setItems(list);
    } catch {
      /* silent — the bell just stays as-is on a transient failure */
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      setItems([]);
      if (userId) load();
    });
    return () => {
      active = false;
    };
  }, [userId, load]);

  const receive = useCallback((payload) => {
    if (!payload?.id || knownIds.current.has(payload.id)) return;
    knownIds.current.add(payload.id);
    setItems((prev) => [payload, ...prev].slice(0, 50));
    const meta = notificationMeta(payload.type, payload.code);
    notifyAlert(meta.title, { icon: meta.tone === 'red' ? 'error' : 'success' });
  }, []);

  // A visible PWA receives its private Web Push payload from the service
  // worker. Unlike the old guessable broadcast channel, this is tied to the
  // browser's registered push subscription.
  useEffect(() => {
    if (!userId || !('serviceWorker' in navigator)) return undefined;
    const onMessage = (event) => {
      if (event.data?.type === 'SMART_MAPPIA_NOTIFICATION') receive(event.data.payload);
    };
    const onEnabled = () => setConnected(true);
    navigator.serviceWorker.addEventListener('message', onMessage);
    window.addEventListener('smartmappia:push-enabled', onEnabled);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      window.removeEventListener('smartmappia:push-enabled', onEnabled);
    };
  }, [userId, receive]);

  // Authenticated polling also catches alerts when push is unsupported,
  // disabled, or temporarily unavailable.
  useEffect(() => {
    if (!userId) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [userId, load]);

  const unreadCount = items.reduce((n, item) => {
    if (item.read_at !== undefined) return item.read_at ? n : n + 1;
    const at = item.created_at || item.sent_at;
    if (!seenAt) return n + 1;
    return at && new Date(at) > new Date(seenAt) ? n + 1 : n;
  }, 0);

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    try {
      localStorage.setItem(SEEN_KEY, now);
    } catch {
      /* ignore storage errors */
    }
    setSeenAt(now);
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at || now })));
    api.markNotificationsRead().catch(() => {
      /* optimistic UI; the next load reconciles server state */
    });
  }, []);

  return { items, loading, unreadCount, connected, markAllRead, reload: load, seenAt };
}
