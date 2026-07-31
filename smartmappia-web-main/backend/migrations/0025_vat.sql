-- =====================================================================
-- Smart Mappia — Migration 0025: 15% VAT (KSA)
-- For: Supabase / PostgreSQL 15+
--
-- VAT is charged ON TOP of the pre-tax amounts and snapshotted per
-- transaction, so a receipt printed years later still shows the rate that
-- applied on the day — changing the rate in config never rewrites history.
--
-- Food orders:
--   * orders.vat_amount   15% of (subtotal + delivery_fee)
--   * orders.vat_rate     the rate that produced it (0.1500)
--   `orders.total` KEEPS its meaning — what the customer pays — and now
--   equals subtotal + delivery_fee + vat_amount. Payment amounts already
--   derive from total, so they pick VAT up automatically.
--
-- Rides:
--   * bookings.vat_amount   15% of fare_amount
--   * bookings.vat_rate     the rate that produced it
--   * bookings.total_amount fare_amount + vat_amount — what the passenger pays
--   `bookings.fare_amount` deliberately stays EX-VAT because it is the
--   commission base in lib/ledger.js (computeLedger). Putting VAT into it
--   would compute the driver's cut on government money.
--
-- Money already banked is left alone: existing rows get vat_amount 0 and
-- vat_rate 0, and bookings.total_amount backfills to fare_amount. They
-- were genuinely sold without a VAT line, so their receipts stay truthful.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Food orders.
-- ---------------------------------------------------------------------
alter table orders add column if not exists vat_amount numeric(10,2) not null default 0;
alter table orders add column if not exists vat_rate   numeric(5,4)  not null default 0;

alter table orders drop constraint if exists orders_vat_amount_nonneg;
alter table orders add  constraint orders_vat_amount_nonneg check (vat_amount >= 0);

-- ---------------------------------------------------------------------
-- 2. Ride bookings.
-- ---------------------------------------------------------------------
alter table bookings add column if not exists vat_amount   numeric(10,2) not null default 0;
alter table bookings add column if not exists vat_rate     numeric(5,4)  not null default 0;
alter table bookings add column if not exists total_amount numeric(10,2);

alter table bookings drop constraint if exists bookings_vat_amount_nonneg;
alter table bookings add  constraint bookings_vat_amount_nonneg check (vat_amount >= 0);

-- Backfill legacy rows: no VAT was charged, so the payable total is the fare.
update bookings set total_amount = fare_amount where total_amount is null;

-- ---------------------------------------------------------------------
-- 3. Re-grant the client-role column list on orders (migration 0019).
--    0019 revoked table-wide SELECT and granted an explicit column list to
--    hide platform_margin_total. New columns are NOT covered by that grant,
--    so anon/authenticated cannot read them until listed here. VAT is not
--    confidential (it prints on the customer's receipt), so it is granted;
--    platform_margin_total stays omitted on purpose.
-- ---------------------------------------------------------------------
grant select (vat_amount, vat_rate) on table orders to anon, authenticated;

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   alter table bookings drop column if exists total_amount;
--   alter table bookings drop column if exists vat_rate;
--   alter table bookings drop column if exists vat_amount;
--   alter table orders   drop column if exists vat_rate;
--   alter table orders   drop column if exists vat_amount;
-- =====================================================================
