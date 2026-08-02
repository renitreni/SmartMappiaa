-- =====================================================================
-- Smart Mappia — Migration 0013: Grab-style dispatch + merchant vetting
-- For: Supabase / PostgreSQL 15+
--
-- Two changes:
--
-- 1. dispatch_offers — the Grab-style offer cascade, shared by BOTH
--    services. When a job becomes ready for a driver (a verified Pick &
--    Drop booking, or an accepted+paid food order), the backend offers it
--    to the NEAREST online approved driver only. The driver has 30
--    seconds to accept; on decline or timeout the offer moves to the
--    next-nearest driver. When every candidate has passed, the job drops
--    into the open pool (the classic first-come feed) so it is never
--    stuck. Accepting is an atomic claim — two drivers can never win the
--    same job (partial unique index + compare-and-swap in the backend).
--
-- 2. Merchant vetting — new restaurants now start UNLISTED
--    (is_active = false) and appear in discovery only after an admin
--    approves them, mirroring how drivers require approval.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses IF NOT EXISTS throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Offer lifecycle enum.
-- ---------------------------------------------------------------------
do $$ begin
  create type dispatch_offer_status as enum (
    'pending', 'accepted', 'declined', 'expired', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. dispatch_offers — one row per driver an offer was shown to.
--    Exactly one of order_id (food) / booking_id (Pick & Drop) is set.
--    The partial unique indexes guarantee at most ONE live offer per job,
--    so the cascade can never fan out to two drivers at once.
-- ---------------------------------------------------------------------
create table if not exists dispatch_offers (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references orders(id) on delete cascade,
  booking_id    uuid references bookings(id) on delete cascade,
  driver_id     uuid not null references profiles(id) on delete cascade,
  status        dispatch_offer_status not null default 'pending',
  round         int not null default 1,
  distance_km   numeric,
  offered_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  responded_at  timestamptz,
  check (num_nonnulls(order_id, booking_id) = 1)
);

create index if not exists idx_dispatch_offers_driver
  on dispatch_offers (driver_id, status);
create index if not exists idx_dispatch_offers_order
  on dispatch_offers (order_id);
create index if not exists idx_dispatch_offers_booking
  on dispatch_offers (booking_id);
-- At most one live (pending) offer per job at any moment.
create unique index if not exists uq_dispatch_offers_pending_order
  on dispatch_offers (order_id) where status = 'pending' and order_id is not null;
create unique index if not exists uq_dispatch_offers_pending_booking
  on dispatch_offers (booking_id) where status = 'pending' and booking_id is not null;

-- RLS: a driver sees only offers addressed to them; admins see all.
-- All writes go through the backend (service role).
alter table dispatch_offers enable row level security;

drop policy if exists dispatch_offers_driver_select on dispatch_offers;
create policy dispatch_offers_driver_select on dispatch_offers
  for select using (driver_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------
-- 3. Merchant onboarding is ADMIN-DRIVEN: restaurants contact SmartMappia,
--    an admin creates the restaurant and imports its menu/prices/photos,
--    and links the owner's portal account afterwards. So:
--      * new restaurants start unlisted (is_active = false) until the
--        admin finishes the import and flips the listing on, and
--      * owner_id becomes nullable (a restaurant can exist before its
--        owner has an account).
--    (Both also cover projects that already ran the original 0009;
--    existing rows are left as-is on purpose.)
-- ---------------------------------------------------------------------
alter table merchants alter column is_active set default false;
alter table merchants alter column owner_id drop not null;

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   alter table merchants alter column is_active set default true;
--   drop table if exists dispatch_offers;
--   drop type if exists dispatch_offer_status;
-- =====================================================================
