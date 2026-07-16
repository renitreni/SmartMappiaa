-- =====================================================================
-- Smart Mappia — Migration 0020: driver service type preferences
-- For: Supabase / PostgreSQL 15+
--
-- A driver chooses which verticals they work, from the driver page:
--   * pick_drop — airport rides (Pick & Drop)
--   * food      — food delivery (rider leg)
--   * shop      — ecommerce (placeholder: selectable now, no dispatch yet)
--
-- Stored as text[] on profiles (values reuse the 0007 order_type words).
-- Default = ALL enabled, so existing drivers keep today's behavior and
-- brand-new drivers receive everything until they opt out.
--
-- Dispatch (lib/dispatch.js) and the pull feeds (/api/driver/available,
-- /api/driver/deliveries/available) only route work of a kind the driver
-- has enabled. Already-assigned rides/deliveries are never gated.
--
-- IMPORTANT: run this BEFORE deploying the matching backend code — the
-- auth middleware selects this column unconditionally afterwards.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (ADD COLUMN IF NOT EXISTS; constraint add is guarded).
-- =====================================================================

alter table profiles
  add column if not exists service_types text[] not null
    default array['pick_drop','food','shop']::text[];

-- Only known values, and never empty (cardinality, not array_length —
-- array_length('{}',1) is NULL and a NULL check would pass).
do $$ begin
  alter table profiles
    add constraint profiles_service_types_allowed
    check (
      service_types <@ array['pick_drop','food','shop']::text[]
      and cardinality(service_types) >= 1
    );
exception when duplicate_object then null; end $$;

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   alter table profiles drop constraint if exists profiles_service_types_allowed;
--   alter table profiles drop column if exists service_types;
-- =====================================================================
