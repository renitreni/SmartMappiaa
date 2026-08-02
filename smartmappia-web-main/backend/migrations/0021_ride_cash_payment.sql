-- =====================================================================
-- Smart Mappia — Migration 0021: cash payment for pick & drop rides
-- For: Supabase / PostgreSQL 15+
--
-- Tap payments are not live yet, so pick & drop offers two ways to pay:
-- manual STC Pay (existing) or cash handed to the driver at pickup.
-- This teaches the ride payment enums the 'cash' value. Cash bookings
-- are created directly in booking_status 'confirmed' (no proof upload);
-- the driver collects the fare and the app records a verified 'cash'
-- payments row when the ride completes.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to re-run (uses ADD VALUE IF NOT EXISTS).
--
-- !! IMPORTANT: PostgreSQL will not let a newly-added enum value be USED
--    in the same transaction that added it. The Supabase SQL Editor runs
--    each statement on its own, so running this file top-to-bottom is
--    fine. But if you copy these ALTER TYPE lines into a wrapped
--    transaction (BEGIN ... COMMIT) together with code that inserts
--    'cash', it will fail. Run/commit the ALTER TYPE statements FIRST.
-- =====================================================================

-- How the passenger pays for the booking.
alter type payment_method add value if not exists 'cash';

-- Provider on the payments row the driver's collection is recorded under.
alter type payment_provider add value if not exists 'cash';
