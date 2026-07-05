-- =====================================================================
-- Smart Mappia — Migration 0011: Food Delivery merchant credit
-- For: Supabase / PostgreSQL 15+
--
-- Third Food Delivery migration (after 0010). Adds the merchant credit
-- ledger behind the 300 SAR operational credit limit:
--   * credit_ledger_type enum (charge / replenish / adjustment)
--   * merchant_credit_ledger — every movement of a merchant's credit
--
-- The columns live on merchants (0009: credit_limit default 300,
-- credit_used default 0). The RULES are enforced in the backend, not in
-- triggers, for MVP simplicity (see FOOD_DELIVERY_BACKEND.md):
--   * every accepted order writes a 'charge' of its platform_margin_total
--     and increments merchants.credit_used
--   * at >= 80% (240 SAR) the backend fires the credit_limit_warning alert
--   * at >= 100% (300 SAR) the merchant can no longer accept orders and
--     is marked suspended until an admin reconciles ('replenish')
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses IF NOT EXISTS throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ledger entry types.
-- ---------------------------------------------------------------------
do $$ begin
  create type credit_ledger_type as enum ('charge', 'replenish', 'adjustment');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. merchant_credit_ledger — an append-only trail of credit movements.
--    amount is always positive; type says which direction it moved
--    (charge increases credit_used, replenish decreases it). balance_after
--    snapshots credit_used right after the movement, so the history is
--    auditable without replaying it.
-- ---------------------------------------------------------------------
create table if not exists merchant_credit_ledger (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references merchants(id) on delete cascade,
  order_id       uuid references orders(id) on delete set null,
  type           credit_ledger_type not null,
  amount         numeric(10,2) not null check (amount >= 0),
  balance_after  numeric(10,2) not null,
  note           text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_credit_ledger_merchant
  on merchant_credit_ledger (merchant_id, created_at desc);
create index if not exists idx_credit_ledger_order
  on merchant_credit_ledger (order_id);

-- ---------------------------------------------------------------------
-- 3. Row-Level Security. The merchant reads their own ledger; admins
--    read everything. All writes happen server-side (service role) so a
--    merchant can never erase or invent credit.
-- ---------------------------------------------------------------------
alter table merchant_credit_ledger enable row level security;

drop policy if exists credit_ledger_owner_select on merchant_credit_ledger;
create policy credit_ledger_owner_select on merchant_credit_ledger
  for select using (
    exists (
      select 1 from merchants m
      where m.id = merchant_credit_ledger.merchant_id and m.owner_id = auth.uid()
    ) or is_admin()
  );

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop table if exists merchant_credit_ledger;
--   drop type if exists credit_ledger_type;
-- =====================================================================
