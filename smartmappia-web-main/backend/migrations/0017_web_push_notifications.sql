-- =====================================================================
-- Smart Mappia — Migration 0017: durable notification links/read state
-- and one web-push subscription owner per browser.
-- =====================================================================

alter table notification_events
  add column if not exists order_id uuid references orders(id) on delete set null,
  add column if not exists code text,
  add column if not exists read_at timestamptz;

create index if not exists idx_notification_events_order
  on notification_events (order_id);

create index if not exists idx_notification_events_user_unread
  on notification_events (user_id, created_at desc)
  where read_at is null;

-- A browser push subscription must belong to only the most recently
-- authenticated account on that browser. Remove historical duplicates before
-- enforcing the invariant.
delete from device_push_tokens older
using device_push_tokens newer
where older.token = newer.token
  and (
    coalesce(older.last_seen_at, older.created_at) < coalesce(newer.last_seen_at, newer.created_at)
    or (
      coalesce(older.last_seen_at, older.created_at) = coalesce(newer.last_seen_at, newer.created_at)
      and older.id::text < newer.id::text
    )
  );

create unique index if not exists idx_device_push_tokens_token
  on device_push_tokens (token);
