-- =====================================================================
-- Smart Mappia — Migration 0010: Food Delivery carts + orders
-- For: Supabase / PostgreSQL 15+
--
-- Second Food Delivery migration (after 0009). Adds:
--   * order_status / fd_payment_status / fd_payment_method enums
--   * carts + cart_items (persistent cart, one per customer+merchant)
--   * orders + order_items (immutable money/menu snapshots)
--   * order_payments (gateway token / transaction id ONLY — never card data)
--   * deliveries (optional MVP hand-off to a driver later)
--   * indexes and RLS on every table
--
-- All money is computed SERVER-SIDE at checkout (30 SAR minimum, per-item
-- margins, 10 SAR delivery fee within 15 km) and stored as a snapshot —
-- see backend lib/foodMoney.js. Clients can never write these tables
-- directly except their own cart.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses IF NOT EXISTS throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Enums. fd_-prefixed where the Pick & Drop schema already claimed
--    the plain name (payment_status / payment_method) with other values.
-- ---------------------------------------------------------------------
do $$ begin
  create type order_status as enum (
    'pending', 'accepted', 'preparing', 'ready',
    'out_for_delivery', 'delivered', 'cancelled', 'rejected'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type fd_payment_status as enum ('awaiting', 'paid', 'failed', 'refunded');
exception when duplicate_object then null; end $$;

-- 'cash' = cash on delivery: the rider collects at the door and marking the
-- order delivered records the payment.
do $$ begin
  create type fd_payment_method as enum ('stcpay', 'tap', 'cash');
exception when duplicate_object then null; end $$;
-- If the enum pre-dates the cash option (re-run), add it in place.
alter type fd_payment_method add value if not exists 'cash';

-- ---------------------------------------------------------------------
-- 2. carts + cart_items — the persistent cart. One active cart per
--    (customer, merchant); unit_price is a display snapshot only — the
--    backend re-reads live menu prices at checkout and never trusts it.
-- ---------------------------------------------------------------------
create table if not exists carts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references profiles(id) on delete cascade,
  merchant_id  uuid not null references merchants(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (customer_id, merchant_id)
);

drop trigger if exists carts_set_updated_at on carts;
create trigger carts_set_updated_at
  before update on carts
  for each row execute function set_updated_at();

create table if not exists cart_items (
  id            uuid primary key default gen_random_uuid(),
  cart_id       uuid not null references carts(id) on delete cascade,
  menu_item_id  uuid not null references menu_items(id) on delete cascade,
  quantity      int not null default 1 check (quantity > 0),
  unit_price    numeric(10,2) not null,
  created_at    timestamptz not null default now(),
  unique (cart_id, menu_item_id)
);

create index if not exists idx_cart_items_cart on cart_items (cart_id);

-- ---------------------------------------------------------------------
-- 3. orders — the heart of food delivery. Money columns are the frozen
--    server-computed snapshot; gateway_transaction_id is the ONLY piece
--    of payment data we keep (PCI-DSS: no card numbers / CVV / expiry).
-- ---------------------------------------------------------------------
create table if not exists orders (
  id                     uuid primary key default gen_random_uuid(),
  order_code             text unique not null default gen_order_code(),
  customer_id            uuid not null references profiles(id) on delete restrict,
  merchant_id            uuid not null references merchants(id) on delete restrict,
  status                 order_status not null default 'pending',

  -- Server-computed money snapshot (lib/foodMoney.js is the only writer).
  subtotal               numeric(10,2) not null,
  delivery_fee           numeric(10,2) not null,
  platform_margin_total  numeric(10,2) not null,
  total                  numeric(10,2) not null,
  distance_km            numeric,

  delivery_address       text not null,
  delivery_lat           double precision,
  delivery_lng           double precision,

  payment_status         fd_payment_status not null default 'awaiting',
  payment_method         fd_payment_method not null default 'stcpay',
  gateway_transaction_id text,

  reject_reason          text,
  created_at             timestamptz not null default now(),
  accepted_at            timestamptz,
  ready_at               timestamptz,
  delivered_at           timestamptz
);

create index if not exists idx_orders_customer   on orders (customer_id, created_at desc);
create index if not exists idx_orders_merchant   on orders (merchant_id, created_at desc);
create index if not exists idx_orders_status     on orders (status);
create index if not exists idx_orders_payment    on orders (payment_status);
create index if not exists idx_orders_created_at on orders (created_at desc);

-- ---------------------------------------------------------------------
-- 4. order_items — per-line snapshot (name + price + margin at the time
--    of the order), so history stays truthful when menus change later.
-- ---------------------------------------------------------------------
create table if not exists order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  menu_item_id     uuid references menu_items(id) on delete set null,
  name_snapshot    text not null,
  unit_price       numeric(10,2) not null,
  quantity         int not null check (quantity > 0),
  line_total       numeric(10,2) not null,
  margin_per_item  numeric(10,2) not null,
  margin_total     numeric(10,2) not null
);

create index if not exists idx_order_items_order on order_items (order_id);

-- ---------------------------------------------------------------------
-- 5. order_payments — one row per payment attempt/confirmation. Stores
--    the gateway token / transaction id and raw gateway payload only.
--    The partial unique index makes webhook confirmation idempotent:
--    the same transaction_id can never be recorded twice.
-- ---------------------------------------------------------------------
create table if not exists order_payments (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references orders(id) on delete cascade,
  provider               fd_payment_method not null,
  amount                 numeric(10,2) not null,
  status                 fd_payment_status not null default 'awaiting',
  gateway_transaction_id text,
  gateway_raw            jsonb,
  created_at             timestamptz not null default now()
);

create index if not exists idx_order_payments_order on order_payments (order_id);
create unique index if not exists uq_order_payments_txn
  on order_payments (gateway_transaction_id)
  where gateway_transaction_id is not null;

-- ---------------------------------------------------------------------
-- 6. deliveries — the rider leg of a food order (Grab-style tracking).
--    One row per order (unique). Photo proof is MANDATORY at both ends:
--    the rider photographs the order at the restaurant before "on the
--    way", and photographs the handover to confirm delivery. Photos live
--    in the private payment-proofs bucket under the order code.
-- ---------------------------------------------------------------------
create table if not exists deliveries (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null unique references orders(id) on delete cascade,
  driver_id            uuid references profiles(id) on delete set null,
  fee                  numeric(10,2),
  status               text,
  pickup_photo_path    text,
  delivery_photo_path  text,
  picked_up_at         timestamptz,
  delivered_at         timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists idx_deliveries_order  on deliveries (order_id);
create index if not exists idx_deliveries_driver on deliveries (driver_id);

-- =====================================================================
-- 7. Row-Level Security
--    Customers manage their own cart and read their own orders. The
--    owning merchant reads their incoming orders. All order WRITES go
--    through the backend (service role) so the 30 SAR minimum, margins,
--    and the credit-on-accept rule can never be bypassed from a client —
--    that is why merchants get SELECT (not UPDATE) here even though they
--    "update" orders through the API.
-- =====================================================================
alter table carts          enable row level security;
alter table cart_items     enable row level security;
alter table orders         enable row level security;
alter table order_items    enable row level security;
alter table order_payments enable row level security;
alter table deliveries     enable row level security;

-- carts: the customer fully manages their own; admins can read.
drop policy if exists carts_self_select on carts;
create policy carts_self_select on carts
  for select using (customer_id = auth.uid() or is_admin());

drop policy if exists carts_self_insert on carts;
create policy carts_self_insert on carts
  for insert with check (customer_id = auth.uid());

drop policy if exists carts_self_update on carts;
create policy carts_self_update on carts
  for update using (customer_id = auth.uid());

drop policy if exists carts_self_delete on carts;
create policy carts_self_delete on carts
  for delete using (customer_id = auth.uid());

-- cart_items: reachable only through a cart you own.
drop policy if exists cart_items_self_select on cart_items;
create policy cart_items_self_select on cart_items
  for select using (
    exists (
      select 1 from carts c
      where c.id = cart_items.cart_id and c.customer_id = auth.uid()
    ) or is_admin()
  );

drop policy if exists cart_items_self_insert on cart_items;
create policy cart_items_self_insert on cart_items
  for insert with check (
    exists (
      select 1 from carts c
      where c.id = cart_items.cart_id and c.customer_id = auth.uid()
    )
  );

drop policy if exists cart_items_self_update on cart_items;
create policy cart_items_self_update on cart_items
  for update using (
    exists (
      select 1 from carts c
      where c.id = cart_items.cart_id and c.customer_id = auth.uid()
    )
  );

drop policy if exists cart_items_self_delete on cart_items;
create policy cart_items_self_delete on cart_items
  for delete using (
    exists (
      select 1 from carts c
      where c.id = cart_items.cart_id and c.customer_id = auth.uid()
    )
  );

-- orders: the customer sees their own, the owning merchant sees theirs,
-- admins see all. No client insert/update — server-side only.
drop policy if exists orders_related_select on orders;
create policy orders_related_select on orders
  for select using (
    customer_id = auth.uid()
    or exists (
      select 1 from merchants m
      where m.id = orders.merchant_id and m.owner_id = auth.uid()
    )
    or is_admin()
  );

-- order_items: visible to whoever can see the parent order.
drop policy if exists order_items_related_select on order_items;
create policy order_items_related_select on order_items
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and (
          o.customer_id = auth.uid()
          or exists (
            select 1 from merchants m
            where m.id = o.merchant_id and m.owner_id = auth.uid()
          )
        )
    ) or is_admin()
  );

-- order_payments: the paying customer and admins only (merchants see the
-- order's payment_status through orders, not the gateway records).
drop policy if exists order_payments_customer_select on order_payments;
create policy order_payments_customer_select on order_payments
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_payments.order_id and o.customer_id = auth.uid()
    ) or is_admin()
  );

-- deliveries: visible to the order's customer, merchant, the assigned
-- driver, and admins.
drop policy if exists deliveries_related_select on deliveries;
create policy deliveries_related_select on deliveries
  for select using (
    driver_id = auth.uid()
    or exists (
      select 1 from orders o
      where o.id = deliveries.order_id
        and (
          o.customer_id = auth.uid()
          or exists (
            select 1 from merchants m
            where m.id = o.merchant_id and m.owner_id = auth.uid()
          )
        )
    ) or is_admin()
  );

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop table if exists deliveries;
--   drop table if exists order_payments;
--   drop table if exists order_items;
--   drop table if exists orders;
--   drop table if exists cart_items;
--   drop table if exists carts;
--   drop type if exists fd_payment_method;
--   drop type if exists fd_payment_status;
--   drop type if exists order_status;
-- =====================================================================
