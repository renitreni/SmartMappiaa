-- =====================================================================
-- Smart Mappia — Migration 0006: payment gateway (Tap Payments)
-- For: Supabase / PostgreSQL 15+
--
-- Lays the groundwork for an online card/wallet flow via Tap Payments,
-- sitting alongside the existing manual STC Pay. This is a PLACEHOLDER:
-- the Tap merchant/API isn't live yet, so this adds schema only. In the
-- app, the hosted-redirect flow is stubbed behind a feature flag and stays
-- off until the merchant account is provisioned.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses ADD VALUE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
--
-- !! IMPORTANT about the enum additions below: PostgreSQL will not let a
--    newly-added enum value be USED in the same transaction that added it.
--    The Supabase SQL Editor runs each statement on its own, so running
--    this whole file top-to-bottom is fine. But if you copy these ALTER
--    TYPE lines into a wrapped transaction (BEGIN ... COMMIT) together with
--    code that inserts 'tap'/'gateway_webhook', it will fail. Run/commit
--    the ALTER TYPE statements FIRST, then use the new values.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Teach the existing enums the new words.
--    Each is its own top-level statement (see the warning above).
-- ---------------------------------------------------------------------

-- How a payment got verified — add the generic gateway-webhook path.
alter type verification_mode add value if not exists 'gateway_webhook';

-- A new provider + matching payment method for Tap.
alter type payment_provider add value if not exists 'tap';
alter type payment_method   add value if not exists 'tap';

-- ---------------------------------------------------------------------
-- 2. Gateway bookkeeping on the payments row.
--    gateway_raw keeps the full provider response for audit/debugging.
-- ---------------------------------------------------------------------
alter table payments
  add column if not exists gateway_provider   text,
  add column if not exists gateway_payment_id text,
  add column if not exists gateway_reference  text,
  add column if not exists gateway_status     text,
  add column if not exists gateway_raw        jsonb;

-- One payments row per gateway payment id (when present). Lets webhook
-- handlers upsert idempotently without creating duplicates.
create unique index if not exists uq_payments_gateway_payment_id
  on payments (gateway_payment_id)
  where gateway_payment_id is not null;

-- ---------------------------------------------------------------------
-- 3. webhook_events — a raw log of every callback the gateway sends.
--    We record the payload, whether the signature checked out, and when
--    we processed it. Invaluable for reconciliation and replay.
-- ---------------------------------------------------------------------
create table if not exists webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text,
  event_type         text,
  gateway_payment_id text,
  booking_id         uuid references bookings(id) on delete set null,
  signature_verified boolean,
  payload            jsonb,
  processed_at       timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists idx_webhook_events_gateway_payment_id
  on webhook_events (gateway_payment_id);
create index if not exists idx_webhook_events_booking
  on webhook_events (booking_id);

-- ---------------------------------------------------------------------
-- 4. Row-Level Security.
--    The backend (service role) writes these; this is just admin read.
-- ---------------------------------------------------------------------
alter table webhook_events enable row level security;

drop policy if exists webhook_events_admin_select on webhook_events;
create policy webhook_events_admin_select on webhook_events
  for select using (is_admin());

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop table if exists webhook_events;
--   drop index if exists uq_payments_gateway_payment_id;
--   alter table payments
--     drop column if exists gateway_provider,
--     drop column if exists gateway_payment_id,
--     drop column if exists gateway_reference,
--     drop column if exists gateway_status,
--     drop column if exists gateway_raw;
--   -- NOTE: Postgres cannot remove a single enum value. To undo the
--   -- ADD VALUE additions you'd have to recreate the enum type, which is
--   -- disruptive — usually best left in place.
-- =====================================================================
