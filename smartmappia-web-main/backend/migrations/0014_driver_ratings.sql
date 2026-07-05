-- =====================================================================
-- Smart Mappia — Migration 0014: driver star ratings (Food + Pick & Drop)
-- For: Supabase / PostgreSQL 15+
--
-- One table for both services: after a food order is delivered or a
-- Pick & Drop trip completes, the customer rates their driver 1-5 stars
-- (optional comment). One rating per order/booking, written by its own
-- customer through the backend.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses IF NOT EXISTS throughout).
-- =====================================================================

create table if not exists driver_ratings (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references profiles(id) on delete cascade,
  customer_id  uuid references profiles(id) on delete set null,
  -- Exactly one of the two targets is set; UNIQUE = one rating per job.
  order_id     uuid unique references orders(id) on delete cascade,
  booking_id   uuid unique references bookings(id) on delete cascade,
  stars        int not null check (stars between 1 and 5),
  comment      text,
  created_at   timestamptz not null default now(),
  check (num_nonnulls(order_id, booking_id) = 1)
);

create index if not exists idx_driver_ratings_driver
  on driver_ratings (driver_id, created_at desc);

-- RLS: the rating customer reads their own; the rated driver sees what
-- they received; admins see all. Writes go through the backend (service
-- role) so ownership + delivered/completed status are enforced there.
alter table driver_ratings enable row level security;

drop policy if exists driver_ratings_related_select on driver_ratings;
create policy driver_ratings_related_select on driver_ratings
  for select using (
    customer_id = auth.uid()
    or driver_id = auth.uid()
    or is_admin()
  );

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop table if exists driver_ratings;
-- =====================================================================
