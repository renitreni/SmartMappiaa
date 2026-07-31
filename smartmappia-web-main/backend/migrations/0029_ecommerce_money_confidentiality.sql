-- =====================================================================
-- Smart Mappia — Migration 0029: Ecommerce money confidentiality
-- For: Supabase / PostgreSQL 15+
--
-- Fourth and final Ecommerce migration. This is the 0019 control applied
-- to the shop vertical, plus the repayment of a debt 0019 left behind.
--
-- WHY THIS EXISTS (handbook Part 13 §13.5.1): RLS filters ROWS but cannot
-- filter COLUMNS, and the platform's markup lives in columns of tables
-- customers legitimately read. Anyone holding the public anon key could
-- otherwise read the store's cut straight from PostgREST:
--   * products.net_price / product_variants.net_price  (the store's cut)
--   * shop_orders.platform_margin_total                (net is derivable)
--   * shop_order_items.margin_per_item / margin_total  (per-line, cleaner)
--
-- Fix: column-level SELECT grants. Postgres grants are table-wide by
-- default, so we revoke table SELECT from the client roles and grant back
-- every column EXCEPT the confidential ones. The backend is unaffected —
-- it uses the service role, which keeps full access.
--
-- THE MAINTENANCE HAZARD, restated because it has already bitten twice:
-- a column added to a granted table LATER is NOT covered by these grants.
-- Any future migration touching products, product_variants, shop_orders,
-- shop_order_items, menu_items, orders or order_items MUST extend the
-- relevant list here or client reads of that column will fail.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (REVOKE/GRANT are idempotent; indexes are IF NOT EXISTS).
-- =====================================================================


-- =====================================================================
-- PART A — the shop vertical
-- =====================================================================

-- ---------------------------------------------------------------------
-- A1. products: hide net_price AND stock_quantity.
--
--     net_price is the obvious one — it is the store's cut.
--
--     stock_quantity is hidden for a less obvious but equally commercial
--     reason: exact real-time inventory is SALES VELOCITY. Anyone holding
--     the public anon key could poll a store's stock every few minutes
--     and derive precisely how many units of every SKU it sells per day —
--     a competitor's dream and something the store never agreed to
--     publish. Food has no equivalent exposure because it has no counts.
--
--     The customer-facing API therefore serves a BANDED availability
--     ('in_stock' / 'low' / 'out') computed server-side from these
--     columns, which is all the storefront UI needs. Exact counts stay
--     with the owning store and admins, who read through the service role.
--     low_stock_threshold goes with it: publishing the threshold alongside
--     a band would let the band be inverted back into a range.
-- ---------------------------------------------------------------------
revoke select on table products from anon, authenticated;
grant select (
  id, merchant_id, category_id, name, description,
  brand, unit, weight_grams, barcode,
  price, image_url,
  track_stock, is_available,
  created_at, updated_at
) on table products to anon, authenticated;

-- ---------------------------------------------------------------------
-- A2. product_variants: hide net_price and stock_quantity, same reasoning.
-- ---------------------------------------------------------------------
revoke select on table product_variants from anon, authenticated;
grant select (
  id, product_id, sku, label, price,
  sort_order, is_available,
  created_at, updated_at
) on table product_variants to anon, authenticated;

-- ---------------------------------------------------------------------
-- A3. shop_orders: hide platform_margin_total.
--     VAT is granted — it prints on the customer's receipt and is not
--     confidential. The stock_* timestamps are internal bookkeeping but
--     are granted anyway: omitting a non-secret column is exactly the
--     trap this migration exists to close, and a `select *` from any
--     client would fail on the gap.
-- ---------------------------------------------------------------------
revoke select on table shop_orders from anon, authenticated;
grant select (
  id, order_code, customer_id, merchant_id, status,
  subtotal, delivery_fee, vat_amount, vat_rate, total, distance_km,
  delivery_address, delivery_lat, delivery_lng, contact_phone,
  payment_status, payment_method, gateway_transaction_id,
  reject_reason,
  stock_reserved_at, stock_released_at,
  created_at, accepted_at, packed_at, ready_at, delivered_at
) on table shop_orders to anon, authenticated;

-- ---------------------------------------------------------------------
-- A4. shop_order_items: hide margin_per_item + margin_total.
-- ---------------------------------------------------------------------
revoke select on table shop_order_items from anon, authenticated;
grant select (
  id, order_id, product_id, variant_id,
  name_snapshot, variant_label_snapshot, sku_snapshot,
  unit_price, quantity, line_total
) on table shop_order_items to anon, authenticated;

-- ---------------------------------------------------------------------
-- A5. Defence in depth: no client may WRITE an order table.
--
--     RLS already blocks this — 0027 deliberately declares no INSERT or
--     UPDATE policy on any order table. These REVOKEs make the same
--     intent explicit at the privilege layer, so a future migration that
--     adds a well-meaning policy cannot silently open a write path.
--     Carts are excluded: they legitimately have self-CRUD policies.
-- ---------------------------------------------------------------------
revoke insert, update, delete on table shop_orders         from anon, authenticated;
revoke insert, update, delete on table shop_order_items    from anon, authenticated;
revoke insert, update, delete on table shop_order_payments from anon, authenticated;
revoke insert, update, delete on table shop_deliveries     from anon, authenticated;


-- ---------------------------------------------------------------------
-- A6. At most one PAID cash row per shop order.
--     Cash rows carry a NULL gateway_transaction_id, and NULLs are
--     distinct in Postgres, so uq_shop_order_payments_txn (0027) cannot
--     dedupe them. Without this, a replayed "mark delivered" could record
--     the same cash collection twice. (0019 §4, repeated.)
-- ---------------------------------------------------------------------
create unique index if not exists uq_shop_order_payments_cash_once
  on shop_order_payments (order_id)
  where provider = 'cash' and status = 'paid';


-- =====================================================================
-- PART B — repay the 0019 debt on the FOOD tables
--
-- 0019 granted a fixed column list. Three columns added afterwards were
-- never granted back, so anon/authenticated cannot read them today:
--   * menu_items.size_options    (0023)
--   * order_items.size_snapshot  (0023)
--   * orders.contact_phone       (0024)
--
-- Only 0025 remembered to re-grant. Nothing is broken right now because
-- every read goes through the service-role backend — but it is a live
-- trap: the first direct PostgREST query for a size or a contact phone
-- would fail with a permission error that looks nothing like its cause.
-- =====================================================================

grant select (size_options)  on table menu_items  to anon, authenticated;
grant select (size_snapshot) on table order_items to anon, authenticated;
grant select (contact_phone) on table orders      to anon, authenticated;



-- =====================================================================
-- VERIFICATION
--
-- check-migrations.js runs with the SERVICE ROLE key and therefore cannot
-- detect a missing column grant even in principle — the service role sees
-- everything. This migration must be verified by hand with an ANON key.
--
-- 1. Confirm the confidential columns are hidden. Each of these must FAIL
--    with "permission denied for table ..." when run as anon:
--
--      select net_price             from products             limit 1;
--      select stock_quantity        from products             limit 1;
--      select net_price             from product_variants     limit 1;
--      select stock_quantity        from product_variants     limit 1;
--      select platform_margin_total from shop_orders          limit 1;
--      select margin_total          from shop_order_items     limit 1;
--      select net_price             from menu_items           limit 1;
--      select platform_margin_total from orders               limit 1;
--
-- 2. Confirm the Part B repair. Each of these must now SUCCEED as anon
--    (returning rows or an empty set, but never a permission error):
--
--      select size_options   from menu_items  limit 1;
--      select size_snapshot  from order_items limit 1;
--      select contact_phone  from orders      limit 1;
--
-- 3. List what the client roles can actually see on a table (run as any
--    role; this reads the catalogue, not the data):
--
--      select table_name, column_name, grantee
--        from information_schema.column_privileges
--       where table_name in ('products','product_variants',
--                            'shop_orders','shop_order_items')
--         and grantee in ('anon','authenticated')
--       order by table_name, column_name;
--
--    Any confidential column appearing in that result is a live leak.
--
-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop index if exists uq_shop_order_payments_cash_once;
--   grant select on table products          to anon, authenticated;
--   grant select on table product_variants  to anon, authenticated;
--   grant select on table shop_orders       to anon, authenticated;
--   grant select on table shop_order_items  to anon, authenticated;
--   (rolling back Part B is not advisable — it would re-break the three
--    food columns. Nothing depends on them being ungranted.)
-- =====================================================================
