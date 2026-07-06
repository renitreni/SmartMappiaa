-- =====================================================================
-- Smart Mappia — Migration 0015: merchant homepage presentation
-- For: Supabase / PostgreSQL 15+
--
-- Lets admins control how a restaurant appears in the public homepage
-- "Most Loved Flavors" section, without any fake data:
--   * is_featured — admins pick which restaurants lead the homepage grid
--   * badge       — an optional marketing tag (Top Rated / Popular / New /
--                   Trending) shown on the card
--
-- The star rating on the card is NOT stored here — it is aggregated from
-- real customer reviews (the `ratings` table, migration 0012) at read time,
-- and simply hidden until reviews exist. No invented numbers.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses IF NOT EXISTS / idempotent guards throughout).
-- =====================================================================

alter table merchants add column if not exists is_featured boolean not null default false;
alter table merchants add column if not exists badge text;

-- Constrain badge to the known marketing tags (or null = no badge).
alter table merchants drop constraint if exists merchants_badge_chk;
alter table merchants add constraint merchants_badge_chk
  check (badge is null or badge in ('top_rated', 'popular', 'new', 'trending'));

-- Featured restaurants lead the homepage grid; partial index keeps it cheap.
create index if not exists idx_merchants_featured
  on merchants (is_featured) where is_featured;

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   alter table merchants drop constraint if exists merchants_badge_chk;
--   alter table merchants drop column if exists badge;
--   alter table merchants drop column if exists is_featured;
--   drop index if exists idx_merchants_featured;
-- =====================================================================
