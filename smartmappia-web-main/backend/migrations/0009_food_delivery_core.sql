-- =====================================================================
-- Smart Mappia — Migration 0009: Food Delivery core (merchants + menus)
-- For: Supabase / PostgreSQL 15+
--
-- First of four Food Delivery migrations (0009-0012, see
-- docs/food-delivery/FOOD_DELIVERY_ERD.md). This one adds:
--   * the 'merchant' value on user_role
--   * merchant_status + item_type enums
--   * merchants (the restaurant, 1:1 with its owner profile)
--   * menu_categories + menu_items
--   * gen_order_code() — human-friendly FD- order codes
--   * indexes, updated_at triggers, and RLS on every new table
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses IF NOT EXISTS throughout).
--
-- NOTE: the new 'merchant' enum value is added here but deliberately NOT
-- referenced by any query in this same migration (Postgres forbids using
-- a new enum value inside the transaction that added it). Policies below
-- key on ownership (owner_id = auth.uid()), not on the role string.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The merchant role (restaurant owners sign in like everyone else).
-- ---------------------------------------------------------------------
alter type user_role add value if not exists 'merchant';

-- ---------------------------------------------------------------------
-- 2. New enums for the food-delivery vocabulary.
--    item_type drives the per-item platform margin (5 SAR for meals &
--    packages, 3 SAR for drinks/desserts/add-ons) — see the PRD §7.
-- ---------------------------------------------------------------------
do $$ begin
  create type merchant_status as enum ('active', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_type as enum ('meal_package', 'drink_dessert_addon');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3. The food-order code generator. Same look-alike-free alphabet as
--    gen_booking_code(), but prefixed FD- so support can tell services
--    apart at a glance. Looks like: FD-7K3PQ9TM
-- ---------------------------------------------------------------------
create or replace function gen_order_code()
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
  return 'FD-' || code;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. merchants — one row per restaurant, owned by one merchant profile.
--    credit_limit / credit_used implement the 300 SAR operational credit:
--    every accepted order charges its platform margin to credit_used and
--    the backend suspends accepts at >= credit_limit (PRD §7).
-- ---------------------------------------------------------------------
create table if not exists merchants (
  id                 uuid primary key default gen_random_uuid(),
  -- Restaurants are entered by ADMINS (they contact SmartMappia and the
  -- admin imports their menu/prices/photos). owner_id is linked later,
  -- when the restaurant gets a portal account — so it is nullable.
  owner_id           uuid unique references profiles(id) on delete set null,
  name               text not null,
  cuisine_type       text,
  description        text,
  logo_url           text,
  address            text,
  lat                double precision,
  lng                double precision,
  service_radius_km  numeric not null default 15,
  -- Vetting: new restaurants start UNLISTED; an admin approves the listing
  -- (flips is_active to true) before the public can see them. See 0013.
  is_active          boolean not null default false,
  status             merchant_status not null default 'active',
  credit_limit       numeric(10,2) not null default 300,
  credit_used        numeric(10,2) not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_merchants_owner   on merchants (owner_id);
create index if not exists idx_merchants_active  on merchants (is_active, status);
create index if not exists idx_merchants_cuisine on merchants (cuisine_type);

drop trigger if exists merchants_set_updated_at on merchants;
create trigger merchants_set_updated_at
  before update on merchants
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 5. menu_categories — groups on the menu ("Burgers", "Drinks", ...).
-- ---------------------------------------------------------------------
create table if not exists menu_categories (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchants(id) on delete cascade,
  name         text not null,
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists idx_menu_categories_merchant
  on menu_categories (merchant_id, sort_order);

-- ---------------------------------------------------------------------
-- 6. menu_items — what customers actually buy. item_type decides the
--    platform margin the backend charges the merchant on accept.
-- ---------------------------------------------------------------------
create table if not exists menu_items (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchants(id) on delete cascade,
  category_id   uuid references menu_categories(id) on delete set null,
  name          text not null,
  description   text,
  price         numeric(10,2) not null check (price > 0),
  item_type     item_type not null default 'meal_package',
  image_url     text,
  is_available  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_menu_items_merchant  on menu_items (merchant_id);
create index if not exists idx_menu_items_category  on menu_items (category_id);
create index if not exists idx_menu_items_available on menu_items (merchant_id, is_available);

drop trigger if exists menu_items_set_updated_at on menu_items;
create trigger menu_items_set_updated_at
  before update on menu_items
  for each row execute function set_updated_at();

-- =====================================================================
-- 7. Row-Level Security
--    The backend (service role) bypasses these for trusted writes.
--    RLS here covers direct Supabase reads: the public can browse only
--    active restaurants + their menus; a merchant sees/manages only
--    their own rows; admins see everything via is_admin().
-- =====================================================================
alter table merchants       enable row level security;
alter table menu_categories enable row level security;
alter table menu_items      enable row level security;

-- merchants: public discovery of active restaurants; owner + admin see all
-- states of their own row; owner may update (backend also patches via
-- service role). Inserts happen server-side only.
drop policy if exists merchants_public_select on merchants;
create policy merchants_public_select on merchants
  for select using (
    (is_active and status = 'active')
    or owner_id = auth.uid()
    or is_admin()
  );

drop policy if exists merchants_owner_update on merchants;
create policy merchants_owner_update on merchants
  for update using (owner_id = auth.uid());

-- menu_categories: public read of active categories of active restaurants;
-- the owning merchant has full CRUD; admins read everything.
drop policy if exists menu_categories_public_select on menu_categories;
create policy menu_categories_public_select on menu_categories
  for select using (
    (
      is_active
      and exists (
        select 1 from merchants m
        where m.id = menu_categories.merchant_id
          and m.is_active and m.status = 'active'
      )
    )
    or exists (
      select 1 from merchants m
      where m.id = menu_categories.merchant_id and m.owner_id = auth.uid()
    )
    or is_admin()
  );

drop policy if exists menu_categories_owner_insert on menu_categories;
create policy menu_categories_owner_insert on menu_categories
  for insert with check (
    exists (
      select 1 from merchants m
      where m.id = menu_categories.merchant_id and m.owner_id = auth.uid()
    )
  );

drop policy if exists menu_categories_owner_update on menu_categories;
create policy menu_categories_owner_update on menu_categories
  for update using (
    exists (
      select 1 from merchants m
      where m.id = menu_categories.merchant_id and m.owner_id = auth.uid()
    )
  );

drop policy if exists menu_categories_owner_delete on menu_categories;
create policy menu_categories_owner_delete on menu_categories
  for delete using (
    exists (
      select 1 from merchants m
      where m.id = menu_categories.merchant_id and m.owner_id = auth.uid()
    )
  );

-- menu_items: same shape as categories — public sees available items of
-- active restaurants, the owner manages their own, admins read all.
drop policy if exists menu_items_public_select on menu_items;
create policy menu_items_public_select on menu_items
  for select using (
    (
      is_available
      and exists (
        select 1 from merchants m
        where m.id = menu_items.merchant_id
          and m.is_active and m.status = 'active'
      )
    )
    or exists (
      select 1 from merchants m
      where m.id = menu_items.merchant_id and m.owner_id = auth.uid()
    )
    or is_admin()
  );

drop policy if exists menu_items_owner_insert on menu_items;
create policy menu_items_owner_insert on menu_items
  for insert with check (
    exists (
      select 1 from merchants m
      where m.id = menu_items.merchant_id and m.owner_id = auth.uid()
    )
  );

drop policy if exists menu_items_owner_update on menu_items;
create policy menu_items_owner_update on menu_items
  for update using (
    exists (
      select 1 from merchants m
      where m.id = menu_items.merchant_id and m.owner_id = auth.uid()
    )
  );

drop policy if exists menu_items_owner_delete on menu_items;
create policy menu_items_owner_delete on menu_items
  for delete using (
    exists (
      select 1 from merchants m
      where m.id = menu_items.merchant_id and m.owner_id = auth.uid()
    )
  );

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop table if exists menu_items;
--   drop table if exists menu_categories;
--   drop table if exists merchants;
--   drop function if exists gen_order_code();
--   drop type if exists item_type;
--   drop type if exists merchant_status;
--   (enum values on user_role cannot be removed without recreating it)
-- =====================================================================
