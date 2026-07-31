-- =====================================================================
-- Smart Mappia — Migration 0030: Privilege lockdown + shop hardening
-- For: Supabase / PostgreSQL 15+
--
-- Two unrelated-looking halves that share one root cause.
--
--   PART A is a CRITICAL, PRE-EXISTING privilege escalation. It has
--   nothing to do with Ecommerce and has been live since 0001. It is
--   fixed here because this is the first migration written after it was
--   found, and it should not wait.
--
--   PART B closes defects found in 0026-0029 after those were applied.
--   0026-0029 are left untouched (append-only rule, handbook §6.9.1).
--
-- THE SHARED ROOT CAUSE: Supabase grants table-wide INSERT/UPDATE/DELETE
-- on every public table to `anon` and `authenticated` by default. RLS is
-- then the ONLY thing standing between a client holding the public anon
-- key and a write. Wherever an RLS policy is broader than the columns it
-- was meant to protect — `using (id = auth.uid())` with no column list —
-- the gap is total. 0019 and 0029 already applied this reasoning to
-- SELECT; nobody had applied it to writes.
--
-- Verified against production before writing this (read-only probes, plus
-- bounded UPDATE attempts against the all-zeros UUID which can match no
-- row). Every "GRANT EXISTS" below was confirmed, not assumed.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (REVOKE/GRANT are idempotent; DDL uses IF NOT EXISTS).
-- =====================================================================


-- =====================================================================
-- PART A — CRITICAL: any signed-in user can promote themselves to admin
--
-- 0001 line 344:
--     create policy profiles_self_update on profiles
--       for update using (id = auth.uid());
--
-- No column list, no WITH CHECK, and the default table-wide UPDATE grant
-- intact. So any authenticated user, with nothing but the public anon key
-- and their own JWT:
--
--     PATCH /rest/v1/profiles?id=eq.<self>   {"role": "admin"}
--
-- middleware/auth.js reads profiles.role, so requireAdmin then passes and
-- the whole /api/admin surface opens — including the endpoints that
-- legitimately read net_price. The same write sets driver_approved = true
-- (skipping KYC entirely) or cash_owed = 0 (erasing money owed to us).
--
-- This makes the confidentiality work in 0019 and 0029 moot at the API
-- layer: why read the margin columns through PostgREST when you can just
-- become an admin and ask the API for them.
--
-- Handbook Part 13 §13.3.4 currently rates privilege escalation
-- "Residual: None". That is wrong until this migration runs.
--
-- FIX: revoke the table-wide write grants and give back ONLY the columns
-- a user legitimately edits about themselves. Verified safe: no frontend
-- code queries any table directly (the Supabase client is used solely for
-- auth, realtime and storage uploads), and every profile write in the
-- backend goes through the service role, which is unaffected by grants.
-- =====================================================================

revoke insert, update, delete on table profiles from anon, authenticated;

-- Self-editable, and nothing else. Deliberately withheld:
--   role, driver_approved, driver_verification_status  -- escalation
--   cash_owed, cash_owed_limit                         -- money owed to us
--   service_types                                      -- set via the API
--   email                                              -- mirrored from auth
--   id, created_at, updated_at                         -- identity/bookkeeping
--   national_id                                        -- KYC evidence; must
--                                                         not change after
--                                                         documents are vetted
grant update (
  full_name, mobile_number, whatsapp_number,
  avatar_url, address,
  date_of_birth, gender,
  vehicle_type, vehicle_plate
) on table profiles to authenticated;


-- =====================================================================
-- PART B — hardening for 0026-0029
-- =====================================================================

-- ---------------------------------------------------------------------
-- B1. The same write hole on the CATALOGUE tables, both verticals.
--
--     0009 and 0026 give an owner INSERT/UPDATE/DELETE policies on their
--     own menu/catalogue rows. Column-less, same as above. Confirmed on
--     production: `authenticated` holds UPDATE on menu_items, products
--     and merchants.
--
--     What that buys a merchant account, using only the public anon key:
--
--       PATCH /rest/v1/products?merchant_id=eq.<mine> {"net_price": <price>}
--         -> markupPerUnit() returns 0 -> the platform earns NOTHING on
--            every future order from that store, silently and forever.
--
--     net_price is admin-only by design: the merchant portal's product
--     form has no such field and the merchant route schema rejects it.
--     That API rule was the only thing enforcing it.
--
--     All catalogue writes go through the service-role backend, so
--     revoking breaks nothing. RLS still governs reads.
-- ---------------------------------------------------------------------
revoke insert, update, delete on table products           from anon, authenticated;
revoke insert, update, delete on table product_variants   from anon, authenticated;
revoke insert, update, delete on table product_categories from anon, authenticated;
revoke insert, update, delete on table menu_items         from anon, authenticated;
revoke insert, update, delete on table menu_categories    from anon, authenticated;

-- ---------------------------------------------------------------------
-- B2. merchants: an owner may not write their own commercial terms.
--
--     merchants_owner_update (0009) is likewise column-less. Three
--     separate escalations, all confirmed reachable:
--       * credit_used = 0 / credit_limit = 999999 -> the 300 SAR credit
--         gate in acceptOrderCore is bypassed permanently
--       * status = 'active' -> un-suspends a suspended merchant
--       * vertical = 'shop' -> A RESTAURANT PROMOTES ITSELF INTO THE
--         STORE VERTICAL. The 0026 discriminator decides which storefront
--         a merchant appears in and which portal its owner gets; it must
--         never be writable by the party it governs.
--
--     is_active and is_featured are ADMIN listing decisions, not owner
--     preferences, so they are withheld too.
-- ---------------------------------------------------------------------
revoke insert, update, delete on table merchants from anon, authenticated;
grant update (
  name, cuisine_type, description, logo_url, address, lat, lng, service_radius_km
) on table merchants to authenticated;

-- ---------------------------------------------------------------------
-- B3. shop_cart_items needs a quantity CEILING at the database.
--
--     This is one of the few genuinely client-writable tables (it has
--     self-CRUD policies by design, and 0029 deliberately did not revoke
--     them). The 50-unit cap lived only in cartController.js, so a client
--     writing its own cart row through PostgREST could set quantity to a
--     million: checkout copies it straight through, and the resulting
--     order's platform markup instantly exhausts the store's credit and
--     auto-suspends it.
-- ---------------------------------------------------------------------
alter table shop_cart_items drop constraint if exists shop_cart_items_quantity_check;
alter table shop_cart_items drop constraint if exists shop_cart_items_quantity_range;
alter table shop_cart_items add  constraint shop_cart_items_quantity_range
  check (quantity between 1 and 50);

-- ---------------------------------------------------------------------
-- B4. product_variants: the net_price CHECK was vacuous where it mattered.
--
--     0026 wrote `net_price is null or price is null or (...)`. The
--     `price is null` disjunct switches the guard off in exactly the
--     INHERITING case, which is the case the model encourages. A variant
--     inheriting a 60 SAR product price could carry net_price 80;
--     markupPerUnit() computes -20, clamps to 0, and the platform earns
--     nothing on that variant with no error and no log line.
--
--     New rule: a variant may not set net_price without also setting
--     price. The product-level CHECK governs the fully-inherited case.
-- ---------------------------------------------------------------------
alter table product_variants drop constraint if exists product_variants_net_price_range;
alter table product_variants add  constraint product_variants_net_price_range
  check (
    net_price is null
    or (price is not null and net_price > 0 and net_price <= price)
  );

-- ---------------------------------------------------------------------
-- B5. shop_order_items.reserved_qty — what checkout ACTUALLY took.
--
--     shop_release_stock originally decided "was this line tracked?" from
--     the LIVE products.track_stock flag, read minutes-to-days after the
--     reservation. Two clean desyncs:
--       * untracked at checkout, tracking enabled later, order cancelled
--         -> the release INVENTS units that were never taken
--       * tracked at checkout, tracking disabled later, order cancelled
--         -> the stock never comes back
--
--     Snapshotting the decision per line removes the question entirely.
--     Backfill is safe: there are no shop orders yet (verified: 0 rows).
-- ---------------------------------------------------------------------
alter table shop_order_items
  add column if not exists reserved_qty int not null default 0;

alter table shop_order_items drop constraint if exists shop_order_items_reserved_qty_nonneg;
alter table shop_order_items add  constraint shop_order_items_reserved_qty_nonneg
  check (reserved_qty >= 0);

-- reserved_qty is internal bookkeeping, not confidential — but it is a new
-- column on a table whose SELECT is column-granted (0029), so it must be
-- granted explicitly or client reads of it fail. This is the 0019 hazard,
-- honoured rather than repeated.
grant select (reserved_qty) on table shop_order_items to anon, authenticated;

-- ---------------------------------------------------------------------
-- B6. delivery_status gains a terminal 'cancelled'.
--
--     MOVED OUT to 0031, deliberately. `ALTER TYPE ... ADD VALUE` has
--     transaction restrictions that the Supabase SQL Editor can trip,
--     and because the Editor runs a pasted script as ONE transaction, a
--     failure on that single line silently discards EVERY statement
--     above it — including the privilege lockdown in Part A. That is
--     exactly what happened on the first attempt to apply this file:
--     nothing landed at all, not even the first REVOKE.
--
--     One statement that can abort a whole migration does not belong in
--     the same file as a critical security fix. Run 0031 separately.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- B7. shop_place_order — replaces the 0028 version.
--
--     THE BUG: the caller serialises "no variant" as an EMPTY STRING (the
--     same convention it uses for distance_km and lat/lng), and '' IS NOT
--     NULL in SQL. So the variant branch was taken for every plain
--     product, and ''::uuid raised 22P02 — surfacing to the customer as a
--     generic "Could not place your order" 500, forever, with nothing in
--     the log pointing at the cause. Only all-variant carts worked.
--
--     ALSO: records reserved_qty per line (B5).
--
--     Unchanged: money still comes from lib/shopMoney.js and is never
--     recomputed here; the stock check still rides on the UPDATE itself.
-- ---------------------------------------------------------------------
create or replace function shop_place_order(p_order jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_line       jsonb;
  v_order_id   uuid;
  v_order_code text;
  v_cart_id    uuid;
  v_updated    int;
  v_track      boolean;
  v_name       text;
  v_available  int;
  v_variant    uuid;
begin
  -- 1. Reserve stock, line by line, failing closed.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    -- nullif(): '' means "no variant". See the header.
    v_variant := nullif(v_line ->> 'variant_id', '')::uuid;

    if v_variant is not null then
      -- Variant stock. A variant of an untracked product is untracked too,
      -- so the parent's flag is what decides.
      select p.track_stock, p.name
        into v_track, v_name
        from product_variants pv
        join products p on p.id = pv.product_id
       where pv.id = v_variant;

      if v_track then
        update product_variants
           set stock_quantity = stock_quantity - (v_line ->> 'quantity')::int
         where id = v_variant
           and stock_quantity >= (v_line ->> 'quantity')::int;
        get diagnostics v_updated = row_count;

        if v_updated = 0 then
          select stock_quantity into v_available from product_variants where id = v_variant;
          raise exception 'Not enough stock for %', coalesce(v_name, 'this product')
            using errcode = 'SM001',
                  detail  = jsonb_build_object(
                              'failure_reason', 'out_of_stock',
                              'product',        coalesce(v_name, ''),
                              'variant_id',     v_variant,
                              'requested',      (v_line ->> 'quantity')::int,
                              'available',      coalesce(v_available, 0)
                            )::text;
        end if;
      end if;

    else
      select track_stock, name into v_track, v_name
        from products where id = (v_line ->> 'product_id')::uuid;

      if v_track then
        update products
           set stock_quantity = stock_quantity - (v_line ->> 'quantity')::int
         where id = (v_line ->> 'product_id')::uuid
           and stock_quantity >= (v_line ->> 'quantity')::int;
        get diagnostics v_updated = row_count;

        if v_updated = 0 then
          select stock_quantity into v_available
            from products where id = (v_line ->> 'product_id')::uuid;
          raise exception 'Not enough stock for %', coalesce(v_name, 'this product')
            using errcode = 'SM001',
                  detail  = jsonb_build_object(
                              'failure_reason', 'out_of_stock',
                              'product',        coalesce(v_name, ''),
                              'product_id',     v_line ->> 'product_id',
                              'requested',      (v_line ->> 'quantity')::int,
                              'available',      coalesce(v_available, 0)
                            )::text;
        end if;
      end if;
    end if;
  end loop;

  -- 2. The order itself.
  insert into shop_orders (
    customer_id, merchant_id, subtotal, delivery_fee, platform_margin_total,
    vat_amount, vat_rate, total, distance_km,
    delivery_address, delivery_lat, delivery_lng, contact_phone,
    payment_method, stock_reserved_at
  ) values (
    (p_order ->> 'customer_id')::uuid,
    (p_order ->> 'merchant_id')::uuid,
    (p_order ->> 'subtotal')::numeric,
    (p_order ->> 'delivery_fee')::numeric,
    (p_order ->> 'platform_margin_total')::numeric,
    (p_order ->> 'vat_amount')::numeric,
    (p_order ->> 'vat_rate')::numeric,
    (p_order ->> 'total')::numeric,
    nullif(p_order ->> 'distance_km', '')::numeric,
    p_order ->> 'delivery_address',
    nullif(p_order ->> 'delivery_lat', '')::double precision,
    nullif(p_order ->> 'delivery_lng', '')::double precision,
    nullif(p_order ->> 'contact_phone', ''),
    (p_order ->> 'payment_method')::fd_payment_method,
    now()
  )
  returning id, order_code into v_order_id, v_order_code;

  -- 3. Line snapshots, including what was actually reserved.
  insert into shop_order_items (
    order_id, product_id, variant_id, name_snapshot,
    variant_label_snapshot, sku_snapshot,
    unit_price, quantity, line_total, margin_per_item, margin_total, reserved_qty
  )
  select
    v_order_id,
    (l ->> 'product_id')::uuid,
    nullif(l ->> 'variant_id', '')::uuid,
    l ->> 'name_snapshot',
    nullif(l ->> 'variant_label_snapshot', ''),
    nullif(l ->> 'sku_snapshot', ''),
    (l ->> 'unit_price')::numeric,
    (l ->> 'quantity')::int,
    (l ->> 'line_total')::numeric,
    (l ->> 'margin_per_item')::numeric,
    (l ->> 'margin_total')::numeric,
    case when p.track_stock then (l ->> 'quantity')::int else 0 end
  from jsonb_array_elements(p_lines) as l
  join products p on p.id = (l ->> 'product_id')::uuid;

  -- 4. Empty the cart that produced this order.
  select id into v_cart_id
    from shop_carts
   where customer_id = (p_order ->> 'customer_id')::uuid
     and merchant_id = (p_order ->> 'merchant_id')::uuid;

  if v_cart_id is not null then
    delete from shop_cart_items where cart_id = v_cart_id;
  end if;

  return jsonb_build_object('order_id', v_order_id, 'order_code', v_order_code);
end;
$$;

-- ---------------------------------------------------------------------
-- B8. shop_release_stock — replaces the 0028 version.
--     Adds back oi.reserved_qty (B5) instead of re-deriving from the live
--     track_stock flag. Untracked lines carry 0, so they are no-ops.
-- ---------------------------------------------------------------------
create or replace function shop_release_stock(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reserved timestamptz;
  v_released timestamptz;
  v_lines    int := 0;
begin
  select stock_reserved_at, stock_released_at
    into v_reserved, v_released
    from shop_orders
   where id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('released', false, 'reason', 'order_not_found');
  end if;
  if v_reserved is null then
    return jsonb_build_object('released', false, 'reason', 'never_reserved');
  end if;
  if v_released is not null then
    return jsonb_build_object('released', false, 'reason', 'already_released');
  end if;

  update product_variants pv
     set stock_quantity = pv.stock_quantity + oi.reserved_qty
    from shop_order_items oi
   where oi.order_id = p_order_id
     and oi.variant_id = pv.id
     and oi.reserved_qty > 0;
  get diagnostics v_lines = row_count;

  update products p
     set stock_quantity = p.stock_quantity + oi.reserved_qty
    from shop_order_items oi
   where oi.order_id = p_order_id
     and oi.variant_id is null
     and oi.product_id = p.id
     and oi.reserved_qty > 0;

  update shop_orders set stock_released_at = now() where id = p_order_id;

  return jsonb_build_object('released', true, 'variant_lines', v_lines);
end;
$$;

-- Re-assert the lockdown: CREATE OR REPLACE preserves privileges, but a
-- future DROP + CREATE would silently re-inherit Supabase's default
-- "grant all on functions to anon, authenticated". Cheap to repeat.
revoke all on function shop_place_order(jsonb, jsonb)  from public, anon, authenticated;
revoke all on function shop_release_stock(uuid)        from public, anon, authenticated;
grant execute on function shop_place_order(jsonb, jsonb) to service_role;
grant execute on function shop_release_stock(uuid)       to service_role;


-- =====================================================================
-- VERIFICATION
--
-- 1. PART A is the important one. As an ORDINARY signed-in user (not an
--    admin), with the public anon key, this must now fail with
--    "permission denied for table profiles":
--
--      PATCH /rest/v1/profiles?id=eq.<your own id>   {"role":"admin"}
--
--    and this must still succeed:
--
--      PATCH /rest/v1/profiles?id=eq.<your own id>   {"full_name":"Test"}
--
--    Then confirm the grants directly:
--      select has_column_privilege('authenticated','profiles','role','update');       -- false
--      select has_column_privilege('authenticated','profiles','full_name','update');  -- true
--      select has_column_privilege('authenticated','products','net_price','update');  -- false
--      select has_column_privilege('authenticated','merchants','vertical','update');  -- false
--
-- 2. Confirm nothing broke: sign in, edit your profile name and avatar,
--    and place a food order end to end. All backend writes use the
--    service role and are unaffected by any of this.
--
-- 3. B7 is the checkout blocker. After running this, a cart containing a
--    product WITHOUT variants must check out successfully. Before it,
--    every such checkout returned a 500.
--
-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   grant insert, update, delete on table profiles           to authenticated;
--   grant insert, update, delete on table products           to authenticated;
--   grant insert, update, delete on table product_variants   to authenticated;
--   grant insert, update, delete on table product_categories to authenticated;
--   grant insert, update, delete on table menu_items         to authenticated;
--   grant insert, update, delete on table menu_categories    to authenticated;
--   grant insert, update, delete on table merchants          to authenticated;
--   alter table shop_cart_items  drop constraint if exists shop_cart_items_quantity_range;
--   alter table shop_order_items drop column if exists reserved_qty;
--   (the 0028 function bodies can be restored from that file verbatim;
--    an enum value cannot be removed without recreating the type)
-- =====================================================================
