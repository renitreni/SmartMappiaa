-- =====================================================================
-- Smart Mappia — Migration 0012: Food Delivery extras
-- For: Supabase / PostgreSQL 15+
--
-- Fourth Food Delivery migration (after 0011). Adds the could-have and
-- compliance tables:
--   * ratings — post-delivery food/speed feedback (could-have)
--   * promocodes — percent/fixed discounts (could-have; not applied at
--     checkout yet — money math ships without discounts)
--   * fd_analytics_events — server-side log of the PRD analytics events
--     (view_menu, add_to_cart, checkout_attempt, payment_success, ...)
--   * audit_logs — immutable who-did-what trail for privileged actions
--     and PII access (SDAIA / PCI-DSS requirement, backend doc §2)
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses IF NOT EXISTS throughout).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Enum for promocode discounts.
-- ---------------------------------------------------------------------
do $$ begin
  create type discount_type as enum ('percent', 'fixed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. ratings — one per order, written by its customer after delivery.
-- ---------------------------------------------------------------------
create table if not exists ratings (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null unique references orders(id) on delete cascade,
  customer_id   uuid not null references profiles(id) on delete cascade,
  merchant_id   uuid not null references merchants(id) on delete cascade,
  food_rating   int not null check (food_rating between 1 and 5),
  speed_rating  int check (speed_rating between 1 and 5),
  comment       text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_ratings_merchant on ratings (merchant_id, created_at desc);

-- ---------------------------------------------------------------------
-- 3. promocodes — managed by admins (writes are server-side).
-- ---------------------------------------------------------------------
create table if not exists promocodes (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  discount_type  discount_type not null,
  value          numeric(10,2) not null check (value > 0),
  min_order      numeric(10,2),
  active         boolean not null default true,
  starts_at      timestamptz,
  expires_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. fd_analytics_events — the PRD §9 event log, written server-side
--    (and via POST /api/food/events for client-side events). Event names
--    are lowercase_with_underscores, e.g. 'view_menu', 'add_to_cart',
--    'checkout_attempt', 'payment_success', 'merchant_order_accept',
--    'credit_limit_warning', 'service_suspended'.
-- ---------------------------------------------------------------------
create table if not exists fd_analytics_events (
  id           uuid primary key default gen_random_uuid(),
  event_name   text not null,
  user_id      uuid references profiles(id) on delete set null,
  order_id     uuid references orders(id) on delete set null,
  merchant_id  uuid references merchants(id) on delete set null,
  params       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_fd_events_name    on fd_analytics_events (event_name, created_at desc);
create index if not exists idx_fd_events_merchant on fd_analytics_events (merchant_id);

-- ---------------------------------------------------------------------
-- 5. audit_logs — immutable trail of privileged actions and access to
--    sensitive data (who, what, when). Written server-side only; no
--    update/delete policies exist, so even authenticated users cannot
--    touch it. Required by the PRD's SDAIA/PCI-DSS access-control rules.
-- ---------------------------------------------------------------------
create table if not exists audit_logs (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid references profiles(id) on delete set null,
  action         text not null,
  resource_type  text,
  resource_id    text,
  meta           jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_audit_logs_actor  on audit_logs (actor_id, created_at desc);
create index if not exists idx_audit_logs_action on audit_logs (action, created_at desc);

-- =====================================================================
-- 6. Row-Level Security
-- =====================================================================
alter table ratings             enable row level security;
alter table promocodes          enable row level security;
alter table fd_analytics_events enable row level security;
alter table audit_logs          enable row level security;

-- ratings: the customer writes one for their own delivered order and can
-- read it back; the rated merchant can read theirs; admins read all.
drop policy if exists ratings_customer_insert on ratings;
create policy ratings_customer_insert on ratings
  for insert with check (
    customer_id = auth.uid()
    and exists (
      select 1 from orders o
      where o.id = ratings.order_id and o.customer_id = auth.uid()
    )
  );

drop policy if exists ratings_related_select on ratings;
create policy ratings_related_select on ratings
  for select using (
    customer_id = auth.uid()
    or exists (
      select 1 from merchants m
      where m.id = ratings.merchant_id and m.owner_id = auth.uid()
    )
    or is_admin()
  );

-- promocodes: anyone can read active codes (needed to apply one at
-- checkout); admins read everything. Writes are server-side only.
drop policy if exists promocodes_public_select on promocodes;
create policy promocodes_public_select on promocodes
  for select using (active or is_admin());

-- fd_analytics_events: admin eyes only; writes are server-side.
drop policy if exists fd_events_admin_select on fd_analytics_events;
create policy fd_events_admin_select on fd_analytics_events
  for select using (is_admin());

-- audit_logs: admin read only. Deliberately NO insert/update/delete
-- policies — the log is append-only via the service role.
drop policy if exists audit_logs_admin_select on audit_logs;
create policy audit_logs_admin_select on audit_logs
  for select using (is_admin());

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop table if exists audit_logs;
--   drop table if exists fd_analytics_events;
--   drop table if exists promocodes;
--   drop table if exists ratings;
--   drop type if exists discount_type;
-- =====================================================================
