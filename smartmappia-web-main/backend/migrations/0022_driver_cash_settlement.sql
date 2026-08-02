-- =====================================================================
-- Smart Mappia — Migration 0022: driver cash settlement (pick & drop)
-- For: Supabase / PostgreSQL 15+
--
-- Cash pick & drop rides (migration 0021) leave the driver holding the
-- full fare. The driver keeps their share and OWES SmartMappia the
-- platform commission. This is the mirror image of the restaurant credit
-- model (0011): instead of the platform holding money it owes a partner,
-- the driver holds money they owe the platform.
--
--   * every completed cash ride adds its platform_net (commission) to the
--     driver's cash_owed and writes a 'charge' row here
--   * a driver at/over their cash_owed_limit can no longer accept new cash
--     rides (enforced in the backend, not a trigger) until an admin records
--     a 'settlement' (weekly cadence) which reduces cash_owed back down
--
-- The RULES live in the backend (lib/driverCash.js + driverController /
-- dispatch), matching how 0011 keeps merchant credit rules in code.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses IF NOT EXISTS throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Running balance columns on the driver's profile (mirrors merchants'
--    credit_used / credit_limit). cash_owed is what the driver currently
--    owes SmartMappia; cash_owed_limit is the cap past which they cannot
--    accept new cash rides. Keep the default in sync with
--    config.ledger.cashOwedLimit (DRIVER_CASH_OWED_LIMIT, default 500).
-- ---------------------------------------------------------------------
alter table profiles
  add column if not exists cash_owed       numeric(10,2) not null default 0,
  add column if not exists cash_owed_limit numeric(10,2) not null default 500;

-- ---------------------------------------------------------------------
-- 2. Ledger entry types. 'charge' increases cash_owed (a completed cash
--    ride), 'settlement' decreases it (the driver paid SmartMappia),
--    'adjustment' is a manual admin correction.
-- ---------------------------------------------------------------------
do $$ begin
  create type driver_cash_ledger_type as enum ('charge', 'settlement', 'adjustment');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3. driver_cash_ledger — an append-only trail of cash-owed movements.
--    amount is always positive; type says which direction it moved.
--    balance_after snapshots cash_owed right after the movement, so the
--    history is auditable without replaying it.
-- ---------------------------------------------------------------------
create table if not exists driver_cash_ledger (
  id             uuid primary key default gen_random_uuid(),
  driver_id      uuid not null references profiles(id) on delete cascade,
  booking_id     uuid references bookings(id) on delete set null,
  type           driver_cash_ledger_type not null,
  amount         numeric(10,2) not null check (amount >= 0),
  balance_after  numeric(10,2) not null,
  note           text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_driver_cash_ledger_driver
  on driver_cash_ledger (driver_id, created_at desc);
create index if not exists idx_driver_cash_ledger_booking
  on driver_cash_ledger (booking_id);

-- ---------------------------------------------------------------------
-- 4. Row-Level Security. A driver reads their own ledger; admins read
--    everything. All writes happen server-side (service role) so a driver
--    can never erase or invent what they owe.
-- ---------------------------------------------------------------------
alter table driver_cash_ledger enable row level security;

drop policy if exists driver_cash_ledger_owner_select on driver_cash_ledger;
create policy driver_cash_ledger_owner_select on driver_cash_ledger
  for select using (
    driver_id = auth.uid() or is_admin()
  );

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop table if exists driver_cash_ledger;
--   drop type if exists driver_cash_ledger_type;
--   alter table profiles drop column if exists cash_owed;
--   alter table profiles drop column if exists cash_owed_limit;
-- =====================================================================
