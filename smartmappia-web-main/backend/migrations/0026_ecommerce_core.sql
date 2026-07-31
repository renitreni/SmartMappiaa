-- =====================================================================
-- Smart Mappia — Migration 0026: Ecommerce core (stores + catalogue)
-- For: Supabase / PostgreSQL 15+
--
-- First of four Ecommerce migrations (0026-0029, see
-- docs/archive/ecommerce/ECOMMERCE_PLAN.md). The vertical is called
-- 'shop' in code and data, "Ecommerce" in the UI. This one adds:
--   * merchant_vertical enum + merchants.vertical
--   * product_categories, products, product_variants
--   * gen_shop_order_code() — human-friendly SH- order codes
--   * indexes, updated_at triggers, and RLS on every new table
--
-- A STORE IS A MERCHANT. Rather than a parallel `stores` table, this
-- reuses `merchants` with a vertical discriminator, so owner account
-- provisioning, the credit ledger, suspend/reactivate, featured/badge
-- and the whole merchant auth path work unchanged for both verticals.
--
-- IMPORTANT: every existing food query that reads `merchants` must now
-- filter vertical = 'food'. Existing rows backfill to 'food' via the
-- column default, so this migration is invisible to the live service —
-- but the BACKEND CHANGE IS NOT OPTIONAL. See the plan doc §17.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses IF NOT EXISTS throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The vertical discriminator. New enum (not an ALTER TYPE ADD VALUE),
--    so its values are usable in this same migration.
-- ---------------------------------------------------------------------
do $$ begin
  create type merchant_vertical as enum ('food', 'shop');
exception when duplicate_object then null; end $$;

alter table merchants
  add column if not exists vertical merchant_vertical not null default 'food';

-- Discovery filters on (vertical, is_active, status) in both verticals.
create index if not exists idx_merchants_vertical
  on merchants (vertical, is_active, status);

-- ---------------------------------------------------------------------
-- 2. The shop-order code generator. Same look-alike-free alphabet as
--    gen_order_code(), prefixed SH- so support can tell the three
--    services apart at a glance. Looks like: SH-7K3PQ9TM
--    (Distinct from the 0007 gen_booking_code('shop') SM-SH- prefix,
--    which belongs to the bookings table and is not used here.)
-- ---------------------------------------------------------------------
create or replace function gen_shop_order_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L on purpose
  code text := '';
  i int;
begin
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return 'SH-' || code;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. product_categories — groups in a store ("Rice & Grains", "Household").
--    Mirrors menu_categories exactly.
-- ---------------------------------------------------------------------
create table if not exists product_categories (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchants(id) on delete cascade,
  name         text not null,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists idx_product_categories_merchant
  on product_categories (merchant_id, sort_order);

-- ---------------------------------------------------------------------
-- 4. products — what customers actually buy.
--
--    price     = LIST price, what the customer pays.
--    net_price = what the STORE keeps. CONFIDENTIAL — revoked from the
--                client roles in 0029. price - net_price is our markup,
--                charged to the store's credit on accept. NULL falls back
--                to the flat config.shop.defaultMargin, which keeps
--                single-price rows working (same trick as 0018 for food).
--
--    Retail fields food has no equivalent of: brand, unit, weight_grams,
--    barcode. weight_grams is captured from day one so a weight-banded
--    delivery fee can arrive later without a migration.
--
--    stock_quantity is decremented ATOMICALLY at checkout by the
--    shop_reserve_stock()/shop_place_order() RPC in 0028 — never by
--    application code.
--    track_stock = false exempts a product entirely (made-to-order,
--    unlimited digital, or a store that does not count).
--    is_available is the manual on/off switch, independent of stock.
-- ---------------------------------------------------------------------
create table if not exists products (
  id                   uuid primary key default gen_random_uuid(),
  merchant_id          uuid not null references merchants(id) on delete cascade,
  category_id          uuid references product_categories(id) on delete set null,
  name                 text not null,
  description          text,
  brand                text,
  unit                 text,          -- "1 kg", "500 ml", "pack of 6"
  weight_grams         int,
  barcode              text,          -- EAN/UPC, for scanner stock-taking later
  price                numeric(10,2) not null check (price > 0),
  net_price            numeric(10,2),
  image_url            text,
  stock_quantity       int not null default 0 check (stock_quantity >= 0),
  low_stock_threshold  int not null default 5 check (low_stock_threshold >= 0),
  track_stock          boolean not null default true,
  is_available         boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- The markup can never be negative. Defence in depth for lib/shopMoney.js.
alter table products drop constraint if exists products_net_price_range;
alter table products add  constraint products_net_price_range
  check (net_price is null or (net_price > 0 and net_price <= price));

create index if not exists idx_products_merchant  on products (merchant_id);
create index if not exists idx_products_category  on products (category_id);
create index if not exists idx_products_available on products (merchant_id, is_available);
-- Merchant + admin "what needs restocking" views.
create index if not exists idx_products_low_stock
  on products (merchant_id)
  where track_stock and stock_quantity <= low_stock_threshold;

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 5. product_variants — size / colour / SKU, each with its OWN price and
--    its OWN stock. This is the real variant model that menu_items
--    .size_options jsonb (0023) only approximated for food.
--
--    price / net_price NULL means "inherit the product's". A variant is
--    therefore cheap to add: label + stock is enough.
-- ---------------------------------------------------------------------
create table if not exists product_variants (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  sku             text,
  label           text not null,       -- "500 g", "Large", "Blue"
  price           numeric(10,2) check (price is null or price > 0),
  net_price       numeric(10,2),
  stock_quantity  int not null default 0 check (stock_quantity >= 0),
  sort_order      int not null default 0,
  is_available    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- NOTE: this constraint is TIGHTENED by migration 0030 — the `price is null`
-- disjunct below switches the guard off in the inheriting case, which is the
-- case the model encourages. Left as applied; 0030 replaces it.
alter table product_variants drop constraint if exists product_variants_net_price_range;
alter table product_variants add  constraint product_variants_net_price_range
  check (net_price is null or price is null or (net_price > 0 and net_price <= price));

create index if not exists idx_product_variants_product
  on product_variants (product_id, sort_order);
-- SKUs are unique within a product, case-insensitively, when present.
create unique index if not exists uq_product_variants_sku
  on product_variants (product_id, lower(sku))
  where sku is not null;

drop trigger if exists product_variants_set_updated_at on product_variants;
create trigger product_variants_set_updated_at
  before update on product_variants
  for each row execute function set_updated_at();

-- =====================================================================
-- 6. Row-Level Security
--    Identical shape to 0009: the backend (service role) bypasses these
--    for trusted writes; RLS covers direct Supabase reads. The public
--    browses only available products of listed, active stores; an owner
--    sees and manages only their own rows; admins see everything.
--
--    Note RLS filters ROWS. Hiding the net_price COLUMN needs the grants
--    in 0029 — RLS alone would leak the store's cut to anyone with the
--    public anon key.
-- =====================================================================
alter table product_categories enable row level security;
alter table products           enable row level security;
alter table product_variants   enable row level security;

-- product_categories -----------------------------------------------------
drop policy if exists product_categories_public_select on product_categories;
create policy product_categories_public_select on product_categories
  for select using (
    (
      is_active
      and exists (
        select 1 from merchants m
        where m.id = product_categories.merchant_id
          and m.is_active and m.status = 'active'
      )
    )
    or exists (
      select 1 from merchants m
      where m.id = product_categories.merchant_id and m.owner_id = auth.uid()
    )
    or is_admin()
  );

drop policy if exists product_categories_owner_insert on product_categories;
create policy product_categories_owner_insert on product_categories
  for insert with check (
    exists (
      select 1 from merchants m
      where m.id = product_categories.merchant_id and m.owner_id = auth.uid()
    )
  );

drop policy if exists product_categories_owner_update on product_categories;
create policy product_categories_owner_update on product_categories
  for update using (
    exists (
      select 1 from merchants m
      where m.id = product_categories.merchant_id and m.owner_id = auth.uid()
    )
  );

drop policy if exists product_categories_owner_delete on product_categories;
create policy product_categories_owner_delete on product_categories
  for delete using (
    exists (
      select 1 from merchants m
      where m.id = product_categories.merchant_id and m.owner_id = auth.uid()
    )
  );

-- products ---------------------------------------------------------------
drop policy if exists products_public_select on products;
create policy products_public_select on products
  for select using (
    (
      is_available
      and exists (
        select 1 from merchants m
        where m.id = products.merchant_id
          and m.is_active and m.status = 'active'
      )
    )
    or exists (
      select 1 from merchants m
      where m.id = products.merchant_id and m.owner_id = auth.uid()
    )
    or is_admin()
  );

drop policy if exists products_owner_insert on products;
create policy products_owner_insert on products
  for insert with check (
    exists (
      select 1 from merchants m
      where m.id = products.merchant_id and m.owner_id = auth.uid()
    )
  );

drop policy if exists products_owner_update on products;
create policy products_owner_update on products
  for update using (
    exists (
      select 1 from merchants m
      where m.id = products.merchant_id and m.owner_id = auth.uid()
    )
  );

drop policy if exists products_owner_delete on products;
create policy products_owner_delete on products
  for delete using (
    exists (
      select 1 from merchants m
      where m.id = products.merchant_id and m.owner_id = auth.uid()
    )
  );

-- product_variants: reached through the parent product, one hop further
-- than the tables above.
drop policy if exists product_variants_public_select on product_variants;
create policy product_variants_public_select on product_variants
  for select using (
    exists (
      select 1 from products p
      join merchants m on m.id = p.merchant_id
      where p.id = product_variants.product_id
        and (
          (product_variants.is_available and p.is_available and m.is_active and m.status = 'active')
          or m.owner_id = auth.uid()
        )
    )
    or is_admin()
  );

drop policy if exists product_variants_owner_insert on product_variants;
create policy product_variants_owner_insert on product_variants
  for insert with check (
    exists (
      select 1 from products p
      join merchants m on m.id = p.merchant_id
      where p.id = product_variants.product_id and m.owner_id = auth.uid()
    )
  );

drop policy if exists product_variants_owner_update on product_variants;
create policy product_variants_owner_update on product_variants
  for update using (
    exists (
      select 1 from products p
      join merchants m on m.id = p.merchant_id
      where p.id = product_variants.product_id and m.owner_id = auth.uid()
    )
  );

drop policy if exists product_variants_owner_delete on product_variants;
create policy product_variants_owner_delete on product_variants
  for delete using (
    exists (
      select 1 from products p
      join merchants m on m.id = p.merchant_id
      where p.id = product_variants.product_id and m.owner_id = auth.uid()
    )
  );

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop table if exists product_variants;
--   drop table if exists products;
--   drop table if exists product_categories;
--   drop function if exists gen_shop_order_code();
--   drop index if exists idx_merchants_vertical;
--   alter table merchants drop column if exists vertical;
--   drop type if exists merchant_vertical;
-- =====================================================================
