-- =====================================================================
-- Smart Mappia — Migration 0027: Ecommerce carts + orders
-- For: Supabase / PostgreSQL 15+
--
-- Second Ecommerce migration (after 0026). Adds:
--   * shop_order_status enum
--   * shop_carts + shop_cart_items (persistent cart, one per customer+store)
--   * shop_orders + shop_order_items (immutable money/catalogue snapshots)
--   * shop_order_payments (gateway token / transaction id ONLY)
--   * shop_deliveries (the rider leg)
--   * shop_ratings (the store rating; rider ratings stay in driver_ratings)
--   * indexes and RLS on every table
--
-- REUSED ENUMS, deliberately not duplicated: fd_payment_status,
-- fd_payment_method and delivery_status (all from 0010/0016). They are
-- vertical-neutral in meaning; the fd_ prefix is cosmetic and a parallel
-- set would fork the payment code for no benefit.
--
-- All money is computed SERVER-SIDE at checkout (50 SAR minimum, per-item
-- markup, 15 SAR delivery fee within 15 km, 15% VAT on top) and stored as
-- a snapshot — see backend lib/shopMoney.js. Clients can never write these
-- tables directly except their own cart.
--
-- The 0016 hardening (non-negative money CHECKs, composite hot-path
-- indexes) is applied UP FRONT here rather than retrofitted.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses IF NOT EXISTS throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Status ladder. Same shape as food's order_status, with 'preparing'
--    renamed 'packing' — a store packs a box, it does not cook.
-- ---------------------------------------------------------------------
do $$ begin
  create type shop_order_status as enum (
    'pending', 'accepted', 'packing', 'ready',
    'out_for_delivery', 'delivered', 'cancelled', 'rejected'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. shop_carts + shop_cart_items — the persistent cart. One active cart
--    per (customer, store); unit_price is a display snapshot only — the
--    backend re-reads live catalogue prices at checkout and never trusts
--    it. variant_id is nullable: a product without variants is bought
--    directly.
-- ---------------------------------------------------------------------
create table if not exists shop_carts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references profiles(id) on delete cascade,
  merchant_id  uuid not null references merchants(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (customer_id, merchant_id)
);

drop trigger if exists shop_carts_set_updated_at on shop_carts;
create trigger shop_carts_set_updated_at
  before update on shop_carts
  for each row execute function set_updated_at();

create table if not exists shop_cart_items (
  id          uuid primary key default gen_random_uuid(),
  cart_id     uuid not null references shop_carts(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  variant_id  uuid references product_variants(id) on delete cascade,
  -- NOTE: an upper bound is added by migration 0030. This table is
  -- client-writable, so the controller's MAX_QTY alone was not enough.
  quantity    int not null default 1 check (quantity > 0),
  unit_price  numeric(10,2) not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_shop_cart_items_cart    on shop_cart_items (cart_id);
create index if not exists idx_shop_cart_items_product on shop_cart_items (product_id);
create index if not exists idx_shop_cart_items_variant on shop_cart_items (variant_id);

-- One line per (cart, product, variant). NULLs are distinct in Postgres, so
-- the coalesce is what makes "no variant" collapse to a single line instead
-- of stacking duplicates. Same trick as uq_cart_items_cart_item_size (0023).
create unique index if not exists uq_shop_cart_items_cart_product_variant
  on shop_cart_items (cart_id, product_id, coalesce(variant_id::text, ''));

-- ---------------------------------------------------------------------
-- 3. shop_orders — the heart of the vertical. Money columns are the
--    frozen server-computed snapshot; gateway_transaction_id is the ONLY
--    piece of payment data we keep (PCI-DSS: no card numbers / CVV /
--    expiry). vat_rate and vat_amount are snapshotted per order so a
--    receipt reprinted years later shows the rate actually charged.
-- ---------------------------------------------------------------------
create table if not exists shop_orders (
  id                     uuid primary key default gen_random_uuid(),
  order_code             text unique not null default gen_shop_order_code(),
  customer_id            uuid not null references profiles(id) on delete restrict,
  merchant_id            uuid not null references merchants(id) on delete restrict,
  status                 shop_order_status not null default 'pending',

  -- Server-computed money snapshot (lib/shopMoney.js is the only writer).
  subtotal               numeric(10,2) not null,
  delivery_fee           numeric(10,2) not null,
  platform_margin_total  numeric(10,2) not null,   -- CONFIDENTIAL (0029)
  vat_amount             numeric(10,2) not null default 0,
  vat_rate               numeric(5,4)  not null default 0,
  total                  numeric(10,2) not null,
  distance_km            numeric,

  delivery_address       text not null,
  delivery_lat           double precision,
  delivery_lng           double precision,
  contact_phone          text,

  payment_status         fd_payment_status not null default 'awaiting',
  payment_method         fd_payment_method not null default 'stcpay',
  gateway_transaction_id text,

  reject_reason          text,
  created_at             timestamptz not null default now(),
  accepted_at            timestamptz,
  packed_at              timestamptz,
  ready_at               timestamptz,
  delivered_at           timestamptz
);

-- Non-negative money guards (the 0016 remediation, applied up front).
alter table shop_orders drop constraint if exists shop_orders_subtotal_nonneg;
alter table shop_orders add  constraint shop_orders_subtotal_nonneg check (subtotal >= 0);
alter table shop_orders drop constraint if exists shop_orders_delivery_fee_nonneg;
alter table shop_orders add  constraint shop_orders_delivery_fee_nonneg check (delivery_fee >= 0);
alter table shop_orders drop constraint if exists shop_orders_margin_total_nonneg;
alter table shop_orders add  constraint shop_orders_margin_total_nonneg check (platform_margin_total >= 0);
alter table shop_orders drop constraint if exists shop_orders_vat_amount_nonneg;
alter table shop_orders add  constraint shop_orders_vat_amount_nonneg check (vat_amount >= 0);
alter table shop_orders drop constraint if exists shop_orders_total_nonneg;
alter table shop_orders add  constraint shop_orders_total_nonneg check (total >= 0);

-- Composite indexes matched to the real query paths: customer history,
-- merchant queue, admin lists filtered by status AND sorted by date.
create index if not exists idx_shop_orders_customer
  on shop_orders (customer_id, created_at desc);
create index if not exists idx_shop_orders_merchant
  on shop_orders (merchant_id, created_at desc);
create index if not exists idx_shop_orders_status_created
  on shop_orders (status, created_at desc);
create index if not exists idx_shop_orders_payment_created
  on shop_orders (payment_status, created_at desc);
create index if not exists idx_shop_orders_created_at
  on shop_orders (created_at desc);

-- ---------------------------------------------------------------------
-- 4. shop_order_items — per-line snapshot (name, variant, SKU, price and
--    markup at the time of the order), so history stays truthful when the
--    catalogue changes later. This is also what shop_release_stock()
--    (0028) reads to put stock back on reject/cancel/refund, which is why
--    product_id and variant_id are retained alongside the snapshots.
-- ---------------------------------------------------------------------
create table if not exists shop_order_items (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references shop_orders(id) on delete cascade,
  product_id              uuid references products(id) on delete set null,
  variant_id              uuid references product_variants(id) on delete set null,
  name_snapshot           text not null,
  variant_label_snapshot  text,
  sku_snapshot            text,
  unit_price              numeric(10,2) not null,
  quantity                int not null check (quantity > 0),
  line_total              numeric(10,2) not null,
  margin_per_item         numeric(10,2) not null,   -- CONFIDENTIAL (0029)
  margin_total            numeric(10,2) not null    -- CONFIDENTIAL (0029)
  -- NOTE: migration 0030 adds reserved_qty here, so the stock release can
  -- reverse what was actually taken rather than re-deriving it from a
  -- products.track_stock flag that may have changed since checkout.
);

alter table shop_order_items drop constraint if exists shop_order_items_unit_price_nonneg;
alter table shop_order_items add  constraint shop_order_items_unit_price_nonneg check (unit_price >= 0);
alter table shop_order_items drop constraint if exists shop_order_items_line_total_nonneg;
alter table shop_order_items add  constraint shop_order_items_line_total_nonneg check (line_total >= 0);
alter table shop_order_items drop constraint if exists shop_order_items_margin_per_item_nonneg;
alter table shop_order_items add  constraint shop_order_items_margin_per_item_nonneg check (margin_per_item >= 0);
alter table shop_order_items drop constraint if exists shop_order_items_margin_total_nonneg;
alter table shop_order_items add  constraint shop_order_items_margin_total_nonneg check (margin_total >= 0);

create index if not exists idx_shop_order_items_order   on shop_order_items (order_id);
create index if not exists idx_shop_order_items_product on shop_order_items (product_id);
create index if not exists idx_shop_order_items_variant on shop_order_items (variant_id);

-- ---------------------------------------------------------------------
-- 5. shop_order_payments — one row per payment attempt/confirmation.
--    The partial unique index makes webhook confirmation idempotent: the
--    same transaction_id can never be recorded twice. Cash rows carry a
--    NULL transaction id, so they need the separate index added in 0029.
-- ---------------------------------------------------------------------
create table if not exists shop_order_payments (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references shop_orders(id) on delete cascade,
  provider               fd_payment_method not null,
  amount                 numeric(10,2) not null,
  status                 fd_payment_status not null default 'awaiting',
  gateway_transaction_id text,
  gateway_raw            jsonb,
  proof_path             text,
  created_at             timestamptz not null default now()
);

alter table shop_order_payments drop constraint if exists shop_order_payments_amount_nonneg;
alter table shop_order_payments add  constraint shop_order_payments_amount_nonneg check (amount >= 0);

create index if not exists idx_shop_order_payments_order on shop_order_payments (order_id);
create unique index if not exists uq_shop_order_payments_txn
  on shop_order_payments (gateway_transaction_id)
  where gateway_transaction_id is not null;

-- ---------------------------------------------------------------------
-- 6. shop_deliveries — the rider leg. One row per order (unique).
--    Photo proof is MANDATORY at both ends: the rider photographs the
--    packed order at the store before "on the way", and photographs the
--    handover to confirm delivery. Photos live in the private
--    payment-proofs bucket under the order code.
--    status reuses the delivery_status enum from 0016.
-- ---------------------------------------------------------------------
create table if not exists shop_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null unique references shop_orders(id) on delete cascade,
  driver_id            uuid references profiles(id) on delete set null,
  fee                  numeric(10,2),
  status               delivery_status not null default 'searching',
  pickup_photo_path    text,
  delivery_photo_path  text,
  picked_up_at         timestamptz,
  delivered_at         timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists idx_shop_deliveries_order  on shop_deliveries (order_id);
create index if not exists idx_shop_deliveries_driver on shop_deliveries (driver_id);
-- The open-pool query: unclaimed deliveries visible to every online rider.
create index if not exists idx_shop_deliveries_open
  on shop_deliveries (status) where driver_id is null;

-- ---------------------------------------------------------------------
-- 7. shop_ratings — the STORE rating, one per order. Rider ratings stay
--    in the shared driver_ratings table (widened in 0028).
-- ---------------------------------------------------------------------
create table if not exists shop_ratings (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null unique references shop_orders(id) on delete cascade,
  customer_id     uuid not null references profiles(id) on delete cascade,
  merchant_id     uuid not null references merchants(id) on delete cascade,
  product_rating  int check (product_rating between 1 and 5),
  speed_rating    int check (speed_rating between 1 and 5),
  comment         text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_shop_ratings_merchant on shop_ratings (merchant_id);

-- =====================================================================
-- 8. Row-Level Security
--    Customers manage their own cart and read their own orders. The
--    owning store reads its incoming orders. The assigned rider reads
--    their delivery. All order WRITES go through the backend (service
--    role) so the 50 SAR minimum, the markup, the stock reservation and
--    the credit-on-accept rule can never be bypassed from a client —
--    that is why stores get SELECT (not UPDATE) here even though they
--    "update" orders through the API.
--
--    THERE IS NO CLIENT INSERT OR UPDATE POLICY ON ANY ORDER TABLE.
--    That absence is the load-bearing part of this migration.
-- =====================================================================
alter table shop_carts          enable row level security;
alter table shop_cart_items     enable row level security;
alter table shop_orders         enable row level security;
alter table shop_order_items    enable row level security;
alter table shop_order_payments enable row level security;
alter table shop_deliveries     enable row level security;
alter table shop_ratings        enable row level security;

-- shop_carts: the customer fully manages their own; admins can read.
drop policy if exists shop_carts_self_select on shop_carts;
create policy shop_carts_self_select on shop_carts
  for select using (customer_id = auth.uid() or is_admin());

drop policy if exists shop_carts_self_insert on shop_carts;
create policy shop_carts_self_insert on shop_carts
  for insert with check (customer_id = auth.uid());

drop policy if exists shop_carts_self_update on shop_carts;
create policy shop_carts_self_update on shop_carts
  for update using (customer_id = auth.uid());

drop policy if exists shop_carts_self_delete on shop_carts;
create policy shop_carts_self_delete on shop_carts
  for delete using (customer_id = auth.uid());

-- shop_cart_items: reachable only through a cart you own.
drop policy if exists shop_cart_items_self_select on shop_cart_items;
create policy shop_cart_items_self_select on shop_cart_items
  for select using (
    exists (
      select 1 from shop_carts c
      where c.id = shop_cart_items.cart_id and c.customer_id = auth.uid()
    ) or is_admin()
  );

drop policy if exists shop_cart_items_self_insert on shop_cart_items;
create policy shop_cart_items_self_insert on shop_cart_items
  for insert with check (
    exists (
      select 1 from shop_carts c
      where c.id = shop_cart_items.cart_id and c.customer_id = auth.uid()
    )
  );

drop policy if exists shop_cart_items_self_update on shop_cart_items;
create policy shop_cart_items_self_update on shop_cart_items
  for update using (
    exists (
      select 1 from shop_carts c
      where c.id = shop_cart_items.cart_id and c.customer_id = auth.uid()
    )
  );

drop policy if exists shop_cart_items_self_delete on shop_cart_items;
create policy shop_cart_items_self_delete on shop_cart_items
  for delete using (
    exists (
      select 1 from shop_carts c
      where c.id = shop_cart_items.cart_id and c.customer_id = auth.uid()
    )
  );

-- shop_orders: the customer sees their own, the owning store sees theirs,
-- admins see all. No client insert/update — server-side only.
drop policy if exists shop_orders_related_select on shop_orders;
create policy shop_orders_related_select on shop_orders
  for select using (
    customer_id = auth.uid()
    or exists (
      select 1 from merchants m
      where m.id = shop_orders.merchant_id and m.owner_id = auth.uid()
    )
    or is_admin()
  );

-- shop_order_items: visible to whoever can see the parent order.
drop policy if exists shop_order_items_related_select on shop_order_items;
create policy shop_order_items_related_select on shop_order_items
  for select using (
    exists (
      select 1 from shop_orders o
      where o.id = shop_order_items.order_id
        and (
          o.customer_id = auth.uid()
          or exists (
            select 1 from merchants m
            where m.id = o.merchant_id and m.owner_id = auth.uid()
          )
        )
    ) or is_admin()
  );

-- shop_order_payments: the paying customer and admins only (stores see the
-- order's payment_status through shop_orders, not the gateway records).
drop policy if exists shop_order_payments_customer_select on shop_order_payments;
create policy shop_order_payments_customer_select on shop_order_payments
  for select using (
    exists (
      select 1 from shop_orders o
      where o.id = shop_order_payments.order_id and o.customer_id = auth.uid()
    ) or is_admin()
  );

-- shop_deliveries: visible to the order's customer, store, the assigned
-- rider, and admins.
drop policy if exists shop_deliveries_related_select on shop_deliveries;
create policy shop_deliveries_related_select on shop_deliveries
  for select using (
    driver_id = auth.uid()
    or exists (
      select 1 from shop_orders o
      where o.id = shop_deliveries.order_id
        and (
          o.customer_id = auth.uid()
          or exists (
            select 1 from merchants m
            where m.id = o.merchant_id and m.owner_id = auth.uid()
          )
        )
    ) or is_admin()
  );

-- shop_ratings: the rating customer, the rated store, and admins.
drop policy if exists shop_ratings_related_select on shop_ratings;
create policy shop_ratings_related_select on shop_ratings
  for select using (
    customer_id = auth.uid()
    or exists (
      select 1 from merchants m
      where m.id = shop_ratings.merchant_id and m.owner_id = auth.uid()
    )
    or is_admin()
  );

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop table if exists shop_ratings;
--   drop table if exists shop_deliveries;
--   drop table if exists shop_order_payments;
--   drop table if exists shop_order_items;
--   drop table if exists shop_orders;
--   drop table if exists shop_cart_items;
--   drop table if exists shop_carts;
--   drop type  if exists shop_order_status;
--   (fd_payment_status / fd_payment_method / delivery_status are SHARED
--    with food — never drop them here.)
-- =====================================================================
