-- =====================================================================
-- Smart Mappia — Migration 0007: data collection (order types, snapshots,
--                                 service-prefixed codes, analytics view)
-- For: Supabase / PostgreSQL 15+
--
-- Smart Mappia is growing past airport pick & drop into food, shop, and
-- package delivery. This migration:
--   * adds an order_type to every booking,
--   * snapshots the passenger/driver details onto the booking at key
--     moments (so reports stay accurate even if a profile changes later),
--   * stamps the actual assigned/pickup/dropoff times,
--   * gives booking codes a per-service prefix (SM-PD-, SM-FD-, ...),
--   * and adds a read-only analytics view for admins.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (guarded enum, ADD COLUMN IF NOT EXISTS, OR REPLACE).
-- Existing rows are left untouched (order_type defaults to 'pick_drop').
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The kind-of-order vocabulary (guarded so it's safe to re-run).
-- ---------------------------------------------------------------------
do $$ begin
  create type order_type as enum ('pick_drop', 'food', 'shop', 'package');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. New columns on bookings.
--    The *_snapshot_* fields are captured at assignment/booking time so a
--    later edit to a profile never rewrites history in the reports.
-- ---------------------------------------------------------------------
alter table bookings
  add column if not exists order_type                  order_type not null default 'pick_drop',
  add column if not exists passenger_snapshot_name     text,
  add column if not exists passenger_snapshot_whatsapp text,
  add column if not exists passenger_snapshot_mobile   text,
  add column if not exists driver_snapshot_name        text,
  add column if not exists driver_snapshot_vehicle_type  text,
  add column if not exists driver_snapshot_vehicle_plate text,
  add column if not exists driver_assigned_at          timestamptz,
  add column if not exists actual_pickup_at            timestamptz,
  add column if not exists actual_dropoff_at           timestamptz;

create index if not exists idx_bookings_order_type on bookings (order_type);

-- ---------------------------------------------------------------------
-- 3. Service-prefixed booking codes.
--    We add an overload of gen_booking_code() that takes an order_type and
--    prefixes the code by service. The original no-arg version still
--    exists (it returns SM-... unchanged), but we ALSO give this overload a
--    default of 'pick_drop' so the column default `default gen_booking_code()`
--    on bookings keeps resolving — now to SM-PD-... going forward.
--    The 8-char random suffix uses the same look-alike-free alphabet as 0001.
-- ---------------------------------------------------------------------
create or replace function gen_booking_code(p_order_type order_type)
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L on purpose
  prefix   text;
  code     text := '';
  i        int;
begin
  prefix := case p_order_type
              when 'pick_drop' then 'SM-PD-'
              when 'food'      then 'SM-FD-'
              when 'shop'      then 'SM-SH-'
              when 'package'   then 'SM-PK-'
              else 'SM-PD-'
            end;
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return prefix || code;
end;
$$;

-- Repoint the bookings.booking_code default at the prefixed generator so new
-- bookings get SM-PD-<8> going forward. We pass an explicit arg and the overload
-- has NO default ON PURPOSE: a no-arg gen_booking_code() must keep resolving
-- uniquely to the original 0001 function. (A 1-arg function WITH a default would
-- make a bare gen_booking_code() call ambiguous and break booking inserts.)
-- The no-arg version stays for backward compatibility; non-airport orders should
-- generate their code via gen_booking_code(order_type) explicitly.
alter table bookings
  alter column booking_code set default gen_booking_code('pick_drop'::order_type);

-- ---------------------------------------------------------------------
-- 4. booking_report_v — a read-only analytics view for admins.
--    Joins bookings to the user profile, the (most relevant) payment, and
--    the ledger entry. LEFT JOINs throughout so a booking still shows up
--    even before it has a payment or ledger row.
--    RLS note: a plain view runs with the CALLER's permissions, so this
--    inherits the underlying tables' RLS — in practice it's meant to be
--    queried by an admin session or the service role.
-- ---------------------------------------------------------------------
create or replace view booking_report_v as
select
  b.id                       as booking_id,
  b.booking_code,
  b.order_type,
  b.trip_type,
  b.booking_status,
  b.payment_status,
  b.fare_amount,
  b.currency,
  b.payment_method,
  b.verification_mode,

  -- The customer (live profile + the snapshot frozen on the booking)
  b.user_id,
  u.full_name                as user_full_name,
  u.mobile_number            as user_mobile,
  u.whatsapp_number          as user_whatsapp,
  b.passenger_snapshot_name,
  b.passenger_snapshot_mobile,
  b.passenger_snapshot_whatsapp,

  -- The driver side (snapshot captured at assignment)
  b.assigned_driver_id,
  b.driver_snapshot_name,
  b.driver_snapshot_vehicle_type,
  b.driver_snapshot_vehicle_plate,

  -- Timeline
  b.created_at,
  b.confirmed_at,
  b.driver_assigned_at,
  b.actual_pickup_at,
  b.actual_dropoff_at,

  -- Money in (payment)
  p.provider                 as payment_provider,
  p.amount                   as payment_amount,
  p.status                   as payment_record_status,
  p.verified_at              as payment_verified_at,

  -- Money out (ledger)
  l.gross_fare,
  l.platform_commission,
  l.manual_payment_fee,
  l.driver_gross,
  l.driver_net,
  l.platform_net,
  l.payout_status
from bookings b
left join profiles u on u.id = b.user_id
left join payments p on p.booking_id = b.id
left join ledger_entries l on l.booking_id = b.id;

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop view if exists booking_report_v;
--   -- restore the original code default and drop the overload:
--   alter table bookings alter column booking_code set default gen_booking_code();
--   drop function if exists gen_booking_code(order_type);
--   alter table bookings
--     drop column if exists order_type,
--     drop column if exists passenger_snapshot_name,
--     drop column if exists passenger_snapshot_whatsapp,
--     drop column if exists passenger_snapshot_mobile,
--     drop column if exists driver_snapshot_name,
--     drop column if exists driver_snapshot_vehicle_type,
--     drop column if exists driver_snapshot_vehicle_plate,
--     drop column if exists driver_assigned_at,
--     drop column if exists actual_pickup_at,
--     drop column if exists actual_dropoff_at;
--   -- drop type if exists order_type;  (only once nothing references it)
-- =====================================================================
