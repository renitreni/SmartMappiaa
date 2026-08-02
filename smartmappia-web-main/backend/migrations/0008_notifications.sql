-- =====================================================================
-- Smart Mappia — Migration 0008: notifications / push (APK)
-- For: Supabase / PostgreSQL 15+
--
-- Powers the in-app bell + sound and the "your driver has arrived" /
-- "on the way to drop-off" style alerts. These fire off realtime booking
-- status changes, and — when the app is backgrounded — go out as native
-- push via Capacitor on the Android APK (iOS/web supported too).
--
-- Two tables:
--   * device_push_tokens — the push tokens we deliver to, per device.
--   * notification_events — a log of what we sent (for history + debugging).
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses IF NOT EXISTS throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. device_push_tokens — one row per (user, device token).
--    last_seen_at lets us prune stale tokens; the unique(user_id, token)
--    keeps the same device from being registered twice.
-- ---------------------------------------------------------------------
create table if not exists device_push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  token         text not null,
  platform      text not null check (platform in ('android', 'ios', 'web')),
  app_version   text,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, token)
);

create index if not exists idx_device_push_tokens_user
  on device_push_tokens (user_id);

drop trigger if exists device_push_tokens_set_updated_at on device_push_tokens;
create trigger device_push_tokens_set_updated_at
  before update on device_push_tokens
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 2. notification_events — a record of every alert we sent.
--    channel = 'push' | 'in_app' | 'sms' etc.; type names the alert
--    (e.g. 'driver_arrived', 'on_the_way_to_dropoff').
-- ---------------------------------------------------------------------
create table if not exists notification_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete set null,
  booking_id  uuid references bookings(id) on delete set null,
  type        text,
  channel     text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notification_events_user
  on notification_events (user_id);
create index if not exists idx_notification_events_booking
  on notification_events (booking_id);

-- ---------------------------------------------------------------------
-- 3. Row-Level Security.
--    The backend (service role) does the sending and bypasses these. The
--    rules below let a user manage their own tokens / see their own alert
--    history, with admins able to read everything.
-- ---------------------------------------------------------------------
alter table device_push_tokens  enable row level security;
alter table notification_events enable row level security;

-- device_push_tokens: a user fully manages their own; admins can read all.
drop policy if exists device_push_tokens_self_select on device_push_tokens;
create policy device_push_tokens_self_select on device_push_tokens
  for select using (user_id = auth.uid() or is_admin());

drop policy if exists device_push_tokens_self_insert on device_push_tokens;
create policy device_push_tokens_self_insert on device_push_tokens
  for insert with check (user_id = auth.uid());

drop policy if exists device_push_tokens_self_update on device_push_tokens;
create policy device_push_tokens_self_update on device_push_tokens
  for update using (user_id = auth.uid());

drop policy if exists device_push_tokens_self_delete on device_push_tokens;
create policy device_push_tokens_self_delete on device_push_tokens
  for delete using (user_id = auth.uid());

-- notification_events: a user reads their own history; admins read all.
-- (Writes happen server-side with the service role.)
drop policy if exists notification_events_self_select on notification_events;
create policy notification_events_self_select on notification_events
  for select using (user_id = auth.uid() or is_admin());

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop table if exists notification_events;
--   drop table if exists device_push_tokens;
-- =====================================================================
