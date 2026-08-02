-- =====================================================================
-- Smart Mappia — Migration 0023: Menu item drink sizes (Milk Tea)
-- For: Supabase / PostgreSQL 15+
--
-- Adds per-item SIZE OPTIONS so drinks (Milk Tea category) can be sold
-- as Small / Medium / Large with their own prices:
--   * menu_items.size_options   jsonb array of
--       {"id":"small","label":"Small","price":25,"enabled":true}
--     NULL (or empty) = item has no sizes; nothing changes for it.
--   * cart_items.size           the chosen size id ('small' etc), NULL
--     for size-less items. The (cart, item) uniqueness becomes
--     (cart, item, size) so the same drink can sit in the cart in two
--     different sizes as two separate lines.
--   * order_items.size_snapshot frozen size label at checkout time so
--     history/receipts stay truthful if sizes are edited later.
--
-- Prices are still recomputed SERVER-SIDE at checkout (foodMoney.js);
-- a size only substitutes the unit price. Admin edits size_options via
-- the admin/merchant item endpoints (validated server-side).
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Size options on the menu item.
-- ---------------------------------------------------------------------
alter table menu_items add column if not exists size_options jsonb;

-- ---------------------------------------------------------------------
-- 2. Chosen size on cart lines. The old UNIQUE (cart_id, menu_item_id)
--    must widen to include the size; NULL sizes are folded to '' in a
--    unique INDEX so a size-less item still can't duplicate.
-- ---------------------------------------------------------------------
alter table cart_items add column if not exists size text;

alter table cart_items drop constraint if exists cart_items_cart_id_menu_item_id_key;

create unique index if not exists uq_cart_items_cart_item_size
  on cart_items (cart_id, menu_item_id, coalesce(size, ''));

-- ---------------------------------------------------------------------
-- 3. Frozen size label on order lines.
-- ---------------------------------------------------------------------
alter table order_items add column if not exists size_snapshot text;

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   alter table order_items drop column if exists size_snapshot;
--   drop index if exists uq_cart_items_cart_item_size;
--   alter table cart_items add constraint cart_items_cart_id_menu_item_id_key
--     unique (cart_id, menu_item_id);
--   alter table cart_items drop column if exists size;
--   alter table menu_items drop column if exists size_options;
-- =====================================================================
