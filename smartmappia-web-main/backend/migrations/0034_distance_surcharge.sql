-- =====================================================================
-- Smart Mappia — Migration 0034: distance surcharge past the free radius
-- For: Supabase / PostgreSQL 15+
--
-- Until now anything past 15 km was REFUSED outright: priceOrder() and
-- priceShopOrder() returned failureReason 'outside_radius' and checkout
-- stopped. We now serve those customers and charge for the distance:
--
--     first 15 km   -> the existing flat delivery fee, unchanged
--     beyond 15 km  -> + 0.25 SAR per km
--     beyond 50 km  -> still refused (food + shop only; rides have no cap)
--
-- The surcharge is PLATFORM revenue on all three services. That is why it
-- is stored as its own column rather than folded into an existing total:
--
--   * food / shop — orders.delivery_fee and shop_orders.delivery_fee now
--     hold base + surcharge (the customer pays one delivery line, and VAT
--     is charged on the whole of it). The split is kept so a reprinted
--     receipt can itemise it and the settlement report can explain it.
--
--   * rides — bookings.fare_amount is the DRIVER'S COMMISSION BASE.
--     lib/ledger.js computeLedger() splits exactly that number, so a
--     surcharge added into it would hand ~80% of it straight to the rider.
--     It therefore lives outside fare_amount and inside total_amount,
--     precisely as VAT already does (migration 0025).
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The surcharge columns.
--
--    NOT NULL DEFAULT 0 rather than nullable: every existing row genuinely
--    had no surcharge, and 0 is the honest value. A nullable column would
--    force every reader and every SUM() in the settlement report to cope
--    with null for no gain.
-- ---------------------------------------------------------------------
alter table orders      add column if not exists delivery_surcharge numeric(10,2) not null default 0;
alter table shop_orders add column if not exists delivery_surcharge numeric(10,2) not null default 0;

comment on column orders.delivery_surcharge is
  'Distance surcharge already INCLUDED in delivery_fee (fee = base + surcharge). Platform revenue. 0 within the free radius.';
comment on column shop_orders.delivery_surcharge is
  'Distance surcharge already INCLUDED in delivery_fee (fee = base + surcharge). Platform revenue. 0 within the free radius.';

-- Rides never recorded a trip distance at all — the fare was a flat rate,
-- so there was nothing to record it for.
alter table bookings add column if not exists distance_km        numeric;
alter table bookings add column if not exists distance_surcharge numeric(10,2) not null default 0;

comment on column bookings.distance_km is
  'Pickup -> dropoff distance in km at quote time. NULL when either end had no coordinates.';
comment on column bookings.distance_surcharge is
  'Distance surcharge, EXCLUDED from fare_amount and INCLUDED in total_amount. Platform revenue: fare_amount stays the driver commission base (lib/ledger.js).';

-- ---------------------------------------------------------------------
-- 2. Money columns are never negative — matches the existing _nonneg set.
-- ---------------------------------------------------------------------
alter table orders      drop constraint if exists orders_delivery_surcharge_nonneg;
alter table orders      add  constraint orders_delivery_surcharge_nonneg
  check (delivery_surcharge >= 0);

alter table shop_orders drop constraint if exists shop_orders_delivery_surcharge_nonneg;
alter table shop_orders add  constraint shop_orders_delivery_surcharge_nonneg
  check (delivery_surcharge >= 0);

alter table bookings    drop constraint if exists bookings_distance_surcharge_nonneg;
alter table bookings    add  constraint bookings_distance_surcharge_nonneg
  check (distance_surcharge >= 0);

-- ---------------------------------------------------------------------
-- 3. Grant the new columns back to the client roles.
--
--    THIS IS THE STEP THAT IS EASY TO FORGET, and forgetting it is exactly
--    the debt Part B of 0029 had to repay. 0019 and 0029 replaced the
--    table-wide SELECT on orders / shop_orders with a fixed COLUMN LIST.
--    A column added to such a table afterwards is NOT covered — three
--    columns (size_options, size_snapshot, contact_phone) sat unreadable
--    for months because of it.
--
--    These are customer-facing receipt lines, not margin data: they belong
--    in the same grant set as delivery_fee, NOT the restricted set that
--    hides platform_margin_total / net_price.
--
--    bookings was never column-restricted, so it needs no grant here.
-- ---------------------------------------------------------------------
grant select (delivery_surcharge) on table orders      to anon, authenticated;
grant select (delivery_surcharge) on table shop_orders to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. shop_place_order — replaces the 0030 B7 version.
--
--    Shop checkout does not INSERT from the backend the way food does; it
--    calls this function so stock reservation, the order, the line
--    snapshots and emptying the cart are ONE transaction. The insert names
--    an explicit column list, so a column added to shop_orders is silently
--    dropped on the floor until the function is replaced too — the order
--    would be charged the surcharge (it is inside delivery_fee) while
--    delivery_surcharge stayed 0 and the receipt could not itemise it.
--
--    Body reproduced verbatim from 0030 B7. The ONLY change is
--    delivery_surcharge in the shop_orders column list and its value. The
--    '' -> null convention is deliberate and unchanged: the caller
--    serialises absent values as empty strings (the 0030 bug was taking
--    ''::uuid for "no variant"), so the surcharge uses coalesce to 0
--    rather than nullif — the column is NOT NULL.
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
    customer_id, merchant_id, subtotal, delivery_fee, delivery_surcharge,
    platform_margin_total,
    vat_amount, vat_rate, total, distance_km,
    delivery_address, delivery_lat, delivery_lng, contact_phone,
    payment_method, stock_reserved_at
  ) values (
    (p_order ->> 'customer_id')::uuid,
    (p_order ->> 'merchant_id')::uuid,
    (p_order ->> 'subtotal')::numeric,
    (p_order ->> 'delivery_fee')::numeric,
    coalesce(nullif(p_order ->> 'delivery_surcharge', '')::numeric, 0),
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

-- Same lockdown 0028/0030 applied: only the service role may call it.
revoke all on function shop_place_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function shop_place_order(jsonb, jsonb) to service_role;

-- =====================================================================
-- VERIFICATION
--
--   -- columns exist with the right defaults
--   select table_name, column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where (table_name = 'orders'      and column_name = 'delivery_surcharge')
--       or (table_name = 'shop_orders' and column_name = 'delivery_surcharge')
--       or (table_name = 'bookings'    and column_name in ('distance_km','distance_surcharge'));
--
--   -- must be TRUE — the receipt line has to be readable by clients.
--   -- If these are FALSE the grant above was skipped and a direct
--   -- PostgREST read fails with an error that looks nothing like its cause.
--   select check_column_privilege('authenticated','orders','delivery_surcharge','select');
--   select check_column_privilege('authenticated','shop_orders','delivery_surcharge','select');
--
--   -- must still be FALSE — margin stays hidden, this migration widens nothing.
--   select check_column_privilege('authenticated','orders','platform_margin_total','select');
--
--   -- every pre-existing row must read 0, never null
--   select count(*) as rows_with_null_surcharge from orders where delivery_surcharge is null;
--
--   -- after a >15 km order: fee must equal base + surcharge
--   select order_code, distance_km, delivery_surcharge, delivery_fee, vat_amount, total
--     from orders where delivery_surcharge > 0 order by created_at desc limit 5;
--
--   -- after a >15 km ride: fare_amount must be UNCHANGED at the flat rate,
--   -- with the surcharge visible only in total_amount.
--   select booking_code, distance_km, fare_amount, distance_surcharge, vat_amount, total_amount
--     from bookings where distance_surcharge > 0 order by created_at desc limit 5;
--
-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   alter table orders      drop column if exists delivery_surcharge;
--   alter table shop_orders drop column if exists delivery_surcharge;
--   alter table bookings    drop column if exists distance_km;
--   alter table bookings    drop column if exists distance_surcharge;
--
--   Dropping these LOSES the split between base fee and surcharge on orders
--   already placed — delivery_fee keeps the combined amount, so no customer
--   is over- or under-charged retroactively, but those receipts can no
--   longer be itemised. Export the columns before dropping if the finance
--   record matters.
--
--   Also revert config.delivery.maxRadiusKm to 15 in the same pass, or the
--   backend will keep accepting orders it can no longer price correctly.
-- =====================================================================
