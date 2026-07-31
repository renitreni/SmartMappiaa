-- =====================================================================
-- Smart Mappia — Migration 0032: tighten the 0030 grant + a real probe
-- For: Supabase / PostgreSQL 15+
--
-- Two follow-ups to 0030, both found in review after it was applied.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Take lat / lng / service_radius_km back off the merchants grant.
--
--    0030 granted a merchant direct UPDATE on their own presentation
--    columns, and lat/lng looked like presentation. They are not: they are
--    the PICKUP GEOFENCE TARGET.
--
--    merchants.lat and .lng are nullable, so a merchant holding only the
--    public anon key could run
--
--      PATCH /rest/v1/merchants?id=eq.<mine>  {"lat":null,"lng":null}
--
--    bypassing the portal's own "drop a pin before saving" guard entirely.
--    assertWithinGeofence then treated a null target as "nothing to check
--    against" and passed, so the merchant had silently switched off the
--    photo-proof geofence for every pickup at their store.
--
--    lib/geofence.js now fails closed on a missing pin, which fixes the
--    consequence. This removes the cause: nothing in the app needs a
--    client to write these columns — the portal writes them through the
--    service-role backend, which grants do not constrain.
--
--    service_radius_km goes too. It is selected in a few payloads and read
--    by nothing, so granting write on it buys nothing and would become a
--    live hole the day a radius check starts consulting it.
-- ---------------------------------------------------------------------
revoke update on table merchants from anon, authenticated;
grant update (
  name, cuisine_type, description, logo_url, address
) on table merchants to authenticated;

-- ---------------------------------------------------------------------
-- 2. A privilege probe that actually inspects `authenticated`.
--
--    check-migrations.js verifies the 0030 lockdown by attempting writes
--    with the ANON key and expecting 42501. That only proves `anon` lost
--    the grant. The escalation it exists to catch needed `authenticated`
--    (the RLS policy is `id = auth.uid()`), and grants to the two roles
--    are independent — so a database where `authenticated` still held
--    UPDATE on profiles.role would pass the check.
--
--    0030's OWN reversal notes grant to `authenticated` only, so running
--    them would produce exactly that false pass.
--
--    This function lets the checker ask about any role directly, without
--    needing a signed-in test user. It reads the catalogue only and
--    returns a boolean; it cannot write anything.
-- ---------------------------------------------------------------------
create or replace function check_column_privilege(
  p_role text,
  p_table text,
  p_column text,
  p_privilege text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select has_column_privilege(p_role, p_table::regclass, p_column, p_privilege);
$$;

-- Read-only and non-sensitive (it reveals only whether a grant exists), but
-- there is no reason for a browser to call it.
revoke all on function check_column_privilege(text, text, text, text)
  from public, anon, authenticated;
grant execute on function check_column_privilege(text, text, text, text) to service_role;

-- =====================================================================
-- VERIFICATION
--
--   -- must all be FALSE
--   select check_column_privilege('authenticated','profiles','role','update');
--   select check_column_privilege('authenticated','products','net_price','update');
--   select check_column_privilege('authenticated','merchants','vertical','update');
--   select check_column_privilege('authenticated','merchants','lat','update');
--   select check_column_privilege('anon','profiles','role','update');
--
--   -- must be TRUE (a user still edits their own profile)
--   select check_column_privilege('authenticated','profiles','full_name','update');
--
-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop function if exists check_column_privilege(text, text, text, text);
--   grant update (lat, lng, service_radius_km) on table merchants to authenticated;
--   -- and revert lib/geofence.js to returning null on a missing target,
--   -- which is NOT advised: that is the fail-open this migration closes.
-- =====================================================================
