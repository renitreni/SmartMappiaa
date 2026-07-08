-- =====================================================================
-- Smart Mappia — Migration 0016: Food Delivery audit hardening
-- For: Supabase / PostgreSQL 15+
--
-- Applies the remediation from docs/food-delivery/DATABASE_AUDIT.md. All
-- changes are additive/idempotent and safe on a live DB:
--   * indexes matched to the real hot query paths (dispatch, open pool,
--     admin order lists)
--   * deliveries.status becomes a proper enum (was free-text)
--   * non-negative CHECK guards on money columns
--   * best-effort retention (pg_cron) for the unbounded tables
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Indexes for the real query paths.
-- ---------------------------------------------------------------------

-- Dispatch reads the freshest driver GPS filtered by recorded_at only
-- (no driver_id), so the existing (driver_id, recorded_at) index can't
-- serve it -> add a recorded_at index. driver_locations is write-heavy;
-- this is the single most valuable index for dispatch latency.
create index if not exists idx_driver_locations_recorded
  on driver_locations (recorded_at desc);

-- Open-pool query: deliveries where status='open' and driver_id is null.
create index if not exists idx_deliveries_open
  on deliveries (status) where driver_id is null;

-- Admin order lists filter by status / payment_status AND sort by
-- created_at desc -> composite indexes; drop the near-useless single-column
-- ones they replace.
create index if not exists idx_orders_status_created
  on orders (status, created_at desc);
create index if not exists idx_orders_payment_created
  on orders (payment_status, created_at desc);
drop index if exists idx_orders_status;
drop index if exists idx_orders_payment;

-- A couple of unindexed FK columns exercised by joins / cascade deletes.
create index if not exists idx_order_items_menu_item on order_items (menu_item_id);
create index if not exists idx_cart_items_menu_item  on cart_items (menu_item_id);

-- ---------------------------------------------------------------------
-- 2. deliveries.status -> enum (was unconstrained text). A typo in code
--    could silently break the open-pool query; constrain the values.
-- ---------------------------------------------------------------------
do $$ begin
  create type delivery_status as enum
    ('searching', 'open', 'assigned', 'picked_up', 'delivered');
exception when duplicate_object then null; end $$;

-- Convert only if still text (idempotent — skips once already the enum).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'deliveries' and column_name = 'status' and data_type = 'text'
  ) then
    update deliveries
      set status = 'searching'
      where status is null
         or status not in ('searching', 'open', 'assigned', 'picked_up', 'delivered');
    alter table deliveries alter column status drop default;
    alter table deliveries alter column status type delivery_status
      using status::delivery_status;
    alter table deliveries alter column status set default 'searching';
    alter table deliveries alter column status set not null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Non-negative CHECK guards on money columns (server-computed today,
--    but nothing at the DB level stops a bad write).
-- ---------------------------------------------------------------------
alter table orders drop constraint if exists orders_subtotal_nonneg;
alter table orders add  constraint orders_subtotal_nonneg check (subtotal >= 0);
alter table orders drop constraint if exists orders_delivery_fee_nonneg;
alter table orders add  constraint orders_delivery_fee_nonneg check (delivery_fee >= 0);
alter table orders drop constraint if exists orders_margin_total_nonneg;
alter table orders add  constraint orders_margin_total_nonneg check (platform_margin_total >= 0);
alter table orders drop constraint if exists orders_total_nonneg;
alter table orders add  constraint orders_total_nonneg check (total >= 0);

alter table order_items drop constraint if exists order_items_unit_price_nonneg;
alter table order_items add  constraint order_items_unit_price_nonneg check (unit_price >= 0);
alter table order_items drop constraint if exists order_items_line_total_nonneg;
alter table order_items add  constraint order_items_line_total_nonneg check (line_total >= 0);
alter table order_items drop constraint if exists order_items_margin_per_item_nonneg;
alter table order_items add  constraint order_items_margin_per_item_nonneg check (margin_per_item >= 0);
alter table order_items drop constraint if exists order_items_margin_total_nonneg;
alter table order_items add  constraint order_items_margin_total_nonneg check (margin_total >= 0);

alter table order_payments drop constraint if exists order_payments_amount_nonneg;
alter table order_payments add  constraint order_payments_amount_nonneg check (amount >= 0);

alter table merchants drop constraint if exists merchants_credit_used_nonneg;
alter table merchants add  constraint merchants_credit_used_nonneg check (credit_used >= 0);

-- ---------------------------------------------------------------------
-- 4. Retention for unbounded tables (best-effort via pg_cron).
--    Skips gracefully if pg_cron isn't enabled on the plan — enable it in
--    Supabase (Database -> Extensions -> pg_cron) and re-run, or use a
--    scheduled Edge Function. audit_logs is deliberately NOT pruned
--    (compliance trail).
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron' and installed_version is not null)
     or exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'fd_retention_daily') then
      perform cron.unschedule('fd_retention_daily');
    end if;
    perform cron.schedule('fd_retention_daily', '0 3 * * *', $job$
      delete from driver_locations   where recorded_at < now() - interval '30 days';
      delete from dispatch_offers     where offered_at  < now() - interval '30 days' and status <> 'pending';
      delete from fd_analytics_events where created_at  < now() - interval '180 days';
    $job$);
    raise notice 'fd_retention_daily scheduled (03:00 daily).';
  else
    raise notice 'pg_cron not enabled; skipping retention. Enable pg_cron in Supabase and re-run, or use a scheduled Edge Function.';
  end if;
exception when others then
  raise notice 'retention setup skipped: %', sqlerrm;
end $$;

-- =====================================================================
-- Reversal notes:
--   drop index if exists idx_driver_locations_recorded, idx_deliveries_open,
--     idx_orders_status_created, idx_orders_payment_created,
--     idx_order_items_menu_item, idx_cart_items_menu_item;
--   (recreate idx_orders_status / idx_orders_payment if desired)
--   alter table deliveries alter column status type text using status::text;
--   drop type if exists delivery_status;
--   alter table orders drop constraint if exists orders_subtotal_nonneg, ... ;
--   select cron.unschedule('fd_retention_daily');
-- =====================================================================
