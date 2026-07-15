-- =====================================================================
-- Smart Mappia — Migration 0017: Menu item net price (variable markup)
-- For: Supabase / PostgreSQL 15+
--
-- Moves food pricing from a FLAT platform margin (5 SAR meal_package /
-- 3 SAR drink_dessert_addon, config.food.margins) to a per-item VARIABLE
-- markup that follows the restaurant price lists ("X SAR (Y)" pattern):
--   * menu_items.price      stays the LIST price shown to the customer (Y)
--   * menu_items.net_price  is what the restaurant keeps (X), NEW here
--   * markup per unit        = price - net_price  (varies 0..10+ SAR)
--
-- net_price is NULLABLE on purpose: a NULL means "no net price entered yet"
-- and the checkout math (lib/foodMoney.js) falls back to the flat
-- config.food.margins for that item. So this migration is fully back-
-- compatible — every existing row and every single-price list (e.g. Kuy's)
-- keeps working untouched until an admin fills in a net price.
--
-- The customer bill is unchanged (total = subtotal + delivery_fee); the
-- markup remains the difference the restaurant absorbs, so the restaurant
-- payout = subtotal - platform_margin_total.
--
-- All changes are additive/idempotent and safe on a live DB.
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The net-price column. Nullable, no default (NULL = flat fallback).
-- ---------------------------------------------------------------------
alter table menu_items add column if not exists net_price numeric(10,2);

-- ---------------------------------------------------------------------
-- 2. Guard: when a net price is set it must be positive and never exceed
--    the list price, i.e. markup >= 0. Wrapped so a re-run is a no-op
--    (Postgres has no "add constraint if not exists").
-- ---------------------------------------------------------------------
do $$ begin
  alter table menu_items
    add constraint menu_items_net_price_range
    check (net_price is null or (net_price > 0 and net_price <= price));
exception when duplicate_object then null; end $$;

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   alter table menu_items drop constraint if exists menu_items_net_price_range;
--   alter table menu_items drop column if exists net_price;
-- =====================================================================
