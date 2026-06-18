-- =====================================================================
-- Smart Mappia — Migration 0002: the driver "approved?" switch
-- For: Supabase / PostgreSQL 15+
--
-- Drivers can sign up and sign in straight away, but we don't want a
-- brand-new, unvetted driver picking up passengers on day one. So this
-- adds a simple gate: until an admin flips driver_approved to true, a
-- driver can't see the open ride feed or accept any trips.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Totally safe to run again if you're not sure whether you already did.
-- =====================================================================

-- The flag itself. Everyone starts unapproved (false) and waits for a nod.
alter table profiles
  add column if not exists driver_approved boolean not null default false;

-- Admins are already trusted, so don't make them wait on themselves.
update profiles set driver_approved = true where role = 'admin';

-- A small index since we now filter profiles by role fairly often.
create index if not exists idx_profiles_role on profiles (role);
