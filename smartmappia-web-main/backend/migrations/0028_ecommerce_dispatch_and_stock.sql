-- =====================================================================
-- Smart Mappia — Migration 0028: Ecommerce dispatch + atomic stock
-- For: Supabase / PostgreSQL 15+
--
-- Third Ecommerce migration (after 0026, 0027). Two halves:
--
--   A. Widen the five SHARED tables that hard-code a two-vertical shape,
--      so shop orders can use the existing dispatch cascade, credit
--      ledger, rider ratings, analytics and notification inbox.
--
--   B. Atomic stock, via two SECURITY DEFINER functions. The Supabase JS
--      client has NO multi-table transaction (see the comment at the top
--      of backend/lib/payments.js), and checkout writes four tables while
--      decrementing stock. Doing that as sequential statements would let
--      a mid-sequence failure leave stock reserved for an order that was
--      never created, or an order created for stock that was never held.
--
--      This directly implements handbook Part 13 §13.11.1 P3 ("move
--      multi-table writes into Postgres RPCs") and closes the A04
--      "no transactions" gap for this vertical.
--
--      MONEY MATH STAYS IN JAVASCRIPT. lib/shopMoney.js remains the only
--      thing that decides what an order costs; shop_place_order() takes
--      already-priced lines and is responsible only for ATOMICITY and for
--      the stock check. Never move pricing in here.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run.
-- =====================================================================


-- =====================================================================
-- PART A — widen the shared tables
-- =====================================================================

-- ---------------------------------------------------------------------
-- A1. dispatch_offers — the Grab-style cascade, shared by all three
--     verticals. Exactly one of the three job columns is set.
-- ---------------------------------------------------------------------
alter table dispatch_offers
  add column if not exists shop_order_id uuid references shop_orders(id) on delete cascade;

-- The 0013 CHECK allowed exactly two kinds; widen it to three. Dropping
-- and recreating is safe because the new predicate is strictly weaker for
-- existing rows (every current row still satisfies it).
alter table dispatch_offers drop constraint if exists dispatch_offers_check;
alter table dispatch_offers drop constraint if exists dispatch_offers_one_job;
alter table dispatch_offers add  constraint dispatch_offers_one_job
  check (num_nonnulls(order_id, booking_id, shop_order_id) = 1);

create index if not exists idx_dispatch_offers_shop_order
  on dispatch_offers (shop_order_id);

-- At most one LIVE (pending) offer per shop order, so the cascade can
-- never fan out to two riders at once. This is the DB half of the
-- three-layer double-claim defence (Part 13 §13.2 "Job theft").
create unique index if not exists uq_dispatch_offers_pending_shop_order
  on dispatch_offers (shop_order_id)
  where status = 'pending' and shop_order_id is not null;

-- ---------------------------------------------------------------------
-- A2. merchant_credit_ledger — the store's markup charge needs somewhere
--     to point. order_id stays the food column; both remain nullable.
-- ---------------------------------------------------------------------
alter table merchant_credit_ledger
  add column if not exists shop_order_id uuid references shop_orders(id) on delete set null;

create index if not exists idx_merchant_credit_ledger_shop_order
  on merchant_credit_ledger (shop_order_id);

-- ---------------------------------------------------------------------
-- A3. driver_ratings — one table serves rides, food and now shop.
-- ---------------------------------------------------------------------
alter table driver_ratings
  add column if not exists shop_order_id uuid references shop_orders(id) on delete cascade;

alter table driver_ratings drop constraint if exists driver_ratings_check;
alter table driver_ratings drop constraint if exists driver_ratings_one_job;
alter table driver_ratings add  constraint driver_ratings_one_job
  check (num_nonnulls(order_id, booking_id, shop_order_id) = 1);

-- One rating per shop order, matching the food and ride constraints.
create unique index if not exists uq_driver_ratings_shop_order
  on driver_ratings (shop_order_id)
  where shop_order_id is not null;

-- ---------------------------------------------------------------------
-- A4. fd_analytics_events — the events table predates the second
--     vertical; the name is now a misnomer but renaming it would break
--     the 0016 pg_cron retention job and every existing query.
-- ---------------------------------------------------------------------
alter table fd_analytics_events
  add column if not exists shop_order_id uuid references shop_orders(id) on delete set null;

create index if not exists idx_fd_analytics_events_shop_order
  on fd_analytics_events (shop_order_id);

-- ---------------------------------------------------------------------
-- A5. notification_events — the durable inbox (0008/0017).
-- ---------------------------------------------------------------------
alter table notification_events
  add column if not exists shop_order_id uuid references shop_orders(id) on delete cascade;

create index if not exists idx_notification_events_shop_order
  on notification_events (shop_order_id);


-- =====================================================================
-- PART B — atomic stock
-- =====================================================================

-- ---------------------------------------------------------------------
-- B1. Idempotency markers for the reserve/release pair. Without these a
--     double "cancel" would put the same stock back twice and silently
--     inflate inventory — the stock equivalent of a double refund.
-- ---------------------------------------------------------------------
alter table shop_orders add column if not exists stock_reserved_at timestamptz;
alter table shop_orders add column if not exists stock_released_at timestamptz;

-- ---------------------------------------------------------------------
-- B2. shop_place_order — THE checkout transaction.
--
--     Called by the backend service role with money ALREADY COMPUTED by
--     lib/shopMoney.js. In one transaction it:
--       1. decrements stock for every line, failing closed on a shortfall
--       2. inserts the order
--       3. inserts the line snapshots
--       4. empties the cart
--     Any failure rolls back all four. There is no partial state.
--
--     Stock rule: the UPDATE carries its own `stock_quantity >= qty`
--     predicate, so the decrement and the check are ONE statement. Two
--     concurrent checkouts for the last unit cannot both succeed —
--     row locks serialise them and the loser's UPDATE matches no row.
--     This is the same compare-and-swap discipline used for driver
--     claims and the merchant credit charge.
--
--     p_order  jsonb: the order columns (already priced, server-side)
--     p_lines  jsonb: [{ product_id, variant_id, quantity, unit_price,
--                        name_snapshot, variant_label_snapshot,
--                        sku_snapshot, line_total, margin_per_item,
--                        margin_total }]
--     Returns  jsonb: { order_id, order_code }
--     Raises   SM001 on a stock shortfall, with the product name and the
--              available count in DETAIL as jsonb.
-- ---------------------------------------------------------------------
create or replace function shop_place_order(p_order jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
-- Pinned search_path: a SECURITY DEFINER function without this can be
-- hijacked by a caller-controlled search_path resolving our table names
-- to their own objects. Supabase's own linter flags the omission.
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
begin
  -- 1. Reserve stock, line by line, failing closed.
  --
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if (v_line ->> 'variant_id') is not null then
      -- Variant stock. A variant belonging to an untracked product is
      -- untracked too, so the parent's flag is what decides.
      select p.track_stock, p.name
        into v_track, v_name
        from product_variants pv
        join products p on p.id = pv.product_id
       where pv.id = (v_line ->> 'variant_id')::uuid;

      if v_track then
        update product_variants
           set stock_quantity = stock_quantity - (v_line ->> 'quantity')::int
         where id = (v_line ->> 'variant_id')::uuid
           and stock_quantity >= (v_line ->> 'quantity')::int;
        get diagnostics v_updated = row_count;

        if v_updated = 0 then
          select stock_quantity into v_available
            from product_variants where id = (v_line ->> 'variant_id')::uuid;
          raise exception 'Not enough stock for %', coalesce(v_name, 'this product')
            using errcode = 'SM001',
                  detail  = jsonb_build_object(
                              'failure_reason', 'out_of_stock',
                              'product',        coalesce(v_name, ''),
                              'variant_id',     v_line ->> 'variant_id',
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

  -- 2. The order itself. Money columns come from the caller, which got
  --    them from lib/shopMoney.js — never recomputed here.
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

  -- 3. Line snapshots.
  insert into shop_order_items (
    order_id, product_id, variant_id, name_snapshot,
    variant_label_snapshot, sku_snapshot,
    unit_price, quantity, line_total, margin_per_item, margin_total
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
    (l ->> 'margin_total')::numeric
  from jsonb_array_elements(p_lines) as l;

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
-- B3. shop_release_stock — the inverse, for reject / cancel / refund.
--     Idempotent via stock_released_at: calling it twice is a no-op, so
--     a retried cancel cannot inflate inventory.
--     Only releases what was actually reserved (stock_reserved_at set).
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

  -- Variants first, then bare products. Untracked products are skipped by
  -- the join predicate, so nothing is invented for them.
  update product_variants pv
     set stock_quantity = pv.stock_quantity + oi.quantity
    from shop_order_items oi
    join products p on p.id = oi.product_id
   where oi.order_id = p_order_id
     and oi.variant_id = pv.id
     and p.track_stock;
  get diagnostics v_lines = row_count;

  update products p
     set stock_quantity = p.stock_quantity + oi.quantity
    from shop_order_items oi
   where oi.order_id = p_order_id
     and oi.variant_id is null
     and oi.product_id = p.id
     and p.track_stock;

  update shop_orders set stock_released_at = now() where id = p_order_id;

  return jsonb_build_object('released', true, 'variant_lines', v_lines);
end;
$$;

-- ---------------------------------------------------------------------
-- B4. Lock the functions down.
--
--     SECURITY DEFINER means these run with the OWNER's rights, which
--     bypass RLS. If anon or authenticated could call them, any logged-in
--     user could mint orders and move another store's inventory. Only the
--     backend service role may execute them.
--
--     PostgREST exposes every function in the `public` schema as an RPC
--     endpoint, so revoking EXECUTE is what actually closes the door —
--     the functions still exist, they just refuse unauthorised callers.
-- ---------------------------------------------------------------------
revoke all on function shop_place_order(jsonb, jsonb)  from public, anon, authenticated;
revoke all on function shop_release_stock(uuid)        from public, anon, authenticated;
grant execute on function shop_place_order(jsonb, jsonb) to service_role;
grant execute on function shop_release_stock(uuid)       to service_role;

-- ---------------------------------------------------------------------
-- B5. Extend the 0016 retention job to the new events, so the shop
--     vertical does not reintroduce unbounded growth. Rescheduled rather
--     than added, because cron.schedule replaces by job name.
--     audit_logs stays unpruned on purpose (compliance trail).
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron' and installed_version is not null)
     or exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'fd_retention_daily') then
      perform cron.unschedule('fd_retention_daily');
    end if;
    perform cron.schedule('fd_retention_daily', '0 3 * * *', $job$
      delete from driver_locations    where recorded_at < now() - interval '30 days';
      delete from dispatch_offers     where offered_at  < now() - interval '30 days' and status <> 'pending';
      delete from fd_analytics_events where created_at  < now() - interval '180 days';
    $job$);
    raise notice 'fd_retention_daily rescheduled (03:00 daily).';
  else
    raise notice 'pg_cron not enabled; skipping retention.';
  end if;
exception when others then
  raise notice 'retention setup skipped: %', sqlerrm;
end $$;

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop function if exists shop_release_stock(uuid);
--   drop function if exists shop_place_order(jsonb, jsonb);
--   alter table shop_orders drop column if exists stock_released_at;
--   alter table shop_orders drop column if exists stock_reserved_at;
--   alter table notification_events   drop column if exists shop_order_id;
--   alter table fd_analytics_events   drop column if exists shop_order_id;
--   alter table driver_ratings        drop column if exists shop_order_id;
--   alter table merchant_credit_ledger drop column if exists shop_order_id;
--   alter table dispatch_offers       drop column if exists shop_order_id;
--   -- then restore the two-way CHECKs:
--   -- alter table dispatch_offers add constraint dispatch_offers_one_job
--   --   check (num_nonnulls(order_id, booking_id) = 1);
--   -- alter table driver_ratings  add constraint driver_ratings_one_job
--   --   check (num_nonnulls(order_id, booking_id) = 1);
-- =====================================================================
