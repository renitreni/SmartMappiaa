-- ---------------------------------------------------------------------
-- Profile role inspector / repair  (run in Supabase → SQL Editor)
--
-- Use this to diagnose and fix the "a USER lands on the ADMIN dashboard"
-- bug. Role lives in profiles.role ('passenger' | 'driver' | 'admin').
-- The app only sends an account to /admin when its role is literally
-- 'admin'. Because of the sticky-admin rule in authController.js, a row
-- that was EVER admin stays admin until you change it here (or re-seed).
--
-- This file is a utility, NOT a migration — running it changes data, so
-- read each block before you run it. Nothing here runs automatically.
-- ---------------------------------------------------------------------

-- 1) INSPECT: see every account's role + approval (newest first).
select p.id,
       p.email,
       p.role,
       p.driver_approved,
       p.full_name,
       p.created_at
from public.profiles p
order by p.created_at desc;

-- 2) INSPECT: just the three seeded test accounts. Expect:
--      ***REMOVED***@smartmappia.com   -> passenger
--      ***REMOVED***@smartmappia.com -> driver
--      admin123@smartmappia.com  -> admin
select email, role, driver_approved
from public.profiles
where email in (
  '***REMOVED***@smartmappia.com',
  '***REMOVED***@smartmappia.com',
  'admin123@smartmappia.com'
)
order by email;

-- 3) INSPECT: find any "accidental admins" — admin rows whose email is NOT
--    in your ADMIN_EMAILS allow-list. These are the rows that cause the bug.
--    (Replace the allow-list below with your backend .env ADMIN_EMAILS.)
select email, role
from public.profiles
where role = 'admin'
  and email not in ('admin123@smartmappia.com');

-- ---------------------------------------------------------------------
-- REPAIR  — uncomment the line(s) you need, then run.
-- ---------------------------------------------------------------------

-- 4a) Reset the seeded test user back to passenger.
-- update public.profiles set role = 'passenger'
--  where email = '***REMOVED***@smartmappia.com';

-- 4b) Reset the seeded test driver back to driver (approved for testing).
-- update public.profiles set role = 'driver', driver_approved = true
--  where email = '***REMOVED***@smartmappia.com';

-- 4c) Demote ONE specific account that is wrongly admin (set the email).
-- update public.profiles set role = 'passenger'
--  where email = 'someone@example.com';

-- 4d) Demote ALL admins that are not in your allow-list (bulk fix).
--     DANGER: double-check the allow-list first with query (3) above.
-- update public.profiles set role = 'passenger'
--  where role = 'admin'
--    and email not in ('admin123@smartmappia.com');

-- After repairing, signing in again keeps the corrected role (the sticky
-- rule only re-applies 'admin' if the row is still admin OR the email is in
-- ADMIN_EMAILS). Equivalent shortcut from the shell: `npm run seed:accounts`.
