-- =====================================================================
-- Smart Mappia — Migration 0024: User profile fields + order contact
-- For: Supabase / PostgreSQL 15+
--
-- Backs the new user Profile page and the "edit contact number during
-- delivery" feature:
--   * profiles.avatar_url    public URL of the user's profile picture
--   * profiles.address       default delivery address (free text)
--   * orders.contact_phone   contact number for a food order; collected
--     at checkout (prefilled from the profile) and editable by the
--     customer while the order is still in progress. Riders/admin read
--     it from the order rather than the live profile.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run.
-- =====================================================================

alter table profiles add column if not exists avatar_url text;
alter table profiles add column if not exists address text;

alter table orders add column if not exists contact_phone text;

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   alter table orders drop column if exists contact_phone;
--   alter table profiles drop column if exists address;
--   alter table profiles drop column if exists avatar_url;
-- =====================================================================
