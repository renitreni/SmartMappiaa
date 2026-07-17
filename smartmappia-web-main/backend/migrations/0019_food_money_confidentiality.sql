-- =====================================================================
-- Smart Mappia — Migration 0019: Food money confidentiality (column grants)
-- For: Supabase / PostgreSQL 15+
--
-- Security hardening for the variable-markup model (0018). RLS policies
-- filter ROWS, not COLUMNS — so although the backend carefully whitelists
-- its API responses, anyone holding the public anon key could read the
-- commercially sensitive money columns straight from PostgREST:
--   * menu_items.net_price                      (the restaurant's cut)
--   * orders.platform_margin_total              (net derivable: subtotal - margin)
--   * order_items.margin_per_item / margin_total (per-line net, even cleaner)
--
-- Fix: column-level SELECT grants. Postgres grants are table-wide by
-- default, so we revoke table SELECT from the client roles and grant back
-- every column EXCEPT the confidential ones. The backend is unaffected —
-- it uses the service role, which keeps full access. No frontend code
-- queries these tables directly (verified), so nothing breaks.
--
-- Also adds a defense-in-depth unique index: at most ONE paid cash payment
-- row per order (cash rows carry a NULL gateway_transaction_id, which the
-- existing unique index cannot dedupe — NULLs are distinct in Postgres).
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (REVOKE/GRANT are idempotent; index is IF NOT EXISTS).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. menu_items: hide net_price from client roles.
-- ---------------------------------------------------------------------
revoke select on table menu_items from anon, authenticated;
grant select (
  id, merchant_id, category_id, name, description, price,
  item_type, image_url, is_available, created_at, updated_at
) on table menu_items to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. orders: hide platform_margin_total.
-- ---------------------------------------------------------------------
revoke select on table orders from anon, authenticated;
grant select (
  id, order_code, customer_id, merchant_id, status,
  subtotal, delivery_fee, total, distance_km,
  delivery_address, delivery_lat, delivery_lng,
  payment_status, payment_method, gateway_transaction_id,
  reject_reason, created_at, accepted_at, ready_at, delivered_at
) on table orders to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. order_items: hide margin_per_item + margin_total.
-- ---------------------------------------------------------------------
revoke select on table order_items from anon, authenticated;
grant select (
  id, order_id, menu_item_id, name_snapshot, unit_price, quantity, line_total
) on table order_items to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. order_payments: at most one PAID cash row per order.
-- ---------------------------------------------------------------------
create unique index if not exists uq_order_payments_cash_once
  on order_payments (order_id)
  where provider = 'cash' and status = 'paid';

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop index if exists uq_order_payments_cash_once;
--   grant select on table menu_items to anon, authenticated;
--   grant select on table orders to anon, authenticated;
--   grant select on table order_items to anon, authenticated;
-- =====================================================================
