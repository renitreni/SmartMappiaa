// ---------------------------------------------------------------------
// Notification inbox state for the signed-in user.
//
//   - loads history from GET /api/notifications
//   - subscribes to the user-<id> Realtime channel so new alerts arrive
//     instantly (with a 30s polling safety net when realtime is off)
//   - tracks the unread count via a "last seen" timestamp in localStorage
//   - rings a chime + toast when a fresh notification lands
// ---------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { api } from './api';
import { useBroadcast } from './useBroadcast';
import { realtimeEnabled } from './supabaseClient';
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
    if (!userId) {
      setItems([]);
      return;
    }
    load();
  }, [userId, load]);

  // Live pushes on the user's personal channel.
  const connected = useBroadcast(
    userId ? `user-${userId}` : null,
    {
      notification: (payload) => {
        if (!payload || !payload.id) return;
        if (knownIds.current.has(payload.id)) return;
        knownIds.current.add(payload.id);
        setItems((prev) => [payload, ...prev].slice(0, 50));
        const meta = notificationMeta(payload.type, payload.code);
        notifyAlert(meta.title, { icon: meta.tone === 'red' ? 'error' : 'success' });
      },
    },
    realtimeEnabled && !!userId
  );

  // Polling safety net when realtime is unavailable.
  useEffect(() => {
    if (!userId || connected) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [userId, connected, load]);

  const unreadCount = items.reduce((n, item) => {
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
  }, []);

  return { items, loading, unreadCount, connected, markAllRead, reload: load, seenAt };
}
