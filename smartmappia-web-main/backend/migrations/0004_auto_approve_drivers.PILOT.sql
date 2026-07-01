-- =====================================================================
-- Smart Mappia — Migration 0004: auto-approve drivers (pilot policy)
-- For: Supabase / PostgreSQL 15+
--
-- ⚠️ PILOT ONLY — DO NOT RUN FOR THE PRODUCTION / PUBLIC APP RELEASE. ⚠️
-- This is a temporary shortcut for the closed pilot so testers don't need an
-- admin to approve each driver. For the real app release, SKIP this migration
-- (run only 0001, 0002, 0003) and build proper document-based verification
-- instead — see docs/production/PICK_AND_DROP.md section 4. If you already ran this on
-- an environment that is going to production, reverse it first (see the bottom
-- of this file) so the admin approval gate is back in force.
--
-- Pilot decision: drivers no longer need a manual admin "approve" step.
-- Once a booking's payment is verified, the ride is published to the open
-- feed and ANY signed-in driver can see and accept it automatically.
--
-- This migration:
--   1. flips the column default so future drivers are approved on creation, and
--   2. approves every existing driver so already-registered accounts work now.
--
-- The approval gate itself (requireApprovedDriver) is left in place but is now
-- satisfied for all drivers. To re-enable manual vetting later: set the default
-- back to false, run `update profiles set driver_approved = false where role =
-- 'driver'`, and revert the auto-approve line in
-- backend/controllers/authController.js.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to run again if you're not sure whether you already did.
-- =====================================================================

-- 1. New drivers are approved by default from now on.
alter table profiles
  alter column driver_approved set default true;

-- 2. Approve all existing drivers so the change applies retroactively.
update profiles set driver_approved = true where role = 'driver';

-- =====================================================================
-- REVERSAL (run this before going to production if 0004 was applied).
-- Restores the manual admin-approval gate. Also revert the auto-approve
-- line in backend/controllers/authController.js back to:
--   role === 'admin' ? true : (existing ? existing.driver_approved : false)
--
--   alter table profiles alter column driver_approved set default false;
--   update profiles set driver_approved = false where role = 'driver';
-- =====================================================================
