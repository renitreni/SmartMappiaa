-- =====================================================================
-- Smart Mappia — the starting schema (run this first)
-- For: Supabase / PostgreSQL 15+
--
-- This is the whole foundation for the Airport Pick & Drop MVP: every
-- table, every status type, and the security rules that keep people from
-- reading data that isn't theirs. Payments are manual STC Pay, with a
-- test-mode auto-verify for development.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- (Or drop it in supabase/migrations/ and use `supabase db push`.)
--
-- Run it once on a fresh project. The enums and extensions are safe to
-- re-run, but the tables are created fresh.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensions — we just need gen_random_uuid()
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto;  -- gives us gen_random_uuid()

-- ---------------------------------------------------------------------
-- 1. The status vocabulary
--    These enums are the words the whole app speaks. Defining them here
--    means the database itself rejects any status we didn't plan for.
-- ---------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('passenger', 'driver', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trip_type as enum ('house_to_airport', 'airport_to_house');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('stcpay_manual', 'moyasar');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_provider as enum ('stcpay_manual', 'moyasar');
exception when duplicate_object then null; end $$;

-- Where a payment is in its life: no proof yet -> uploaded -> reviewed -> done.
do $$ begin
  create type payment_status as enum (
    'awaiting_proof', 'proof_uploaded', 'under_review',
    'verified', 'rejected', 'refunded'
  );
exception when duplicate_object then null; end $$;

-- How a payment got verified — automatically (test), by a human, or by Moyasar.
do $$ begin
  create type verification_mode as enum (
    'test_auto', 'admin_manual', 'moyasar_webhook'
  );
exception when duplicate_object then null; end $$;

-- The booking's journey, start to finish.
do $$ begin
  create type booking_status as enum (
    'pending_payment', 'payment_under_review', 'confirmed',
    'driver_assigned', 'driver_on_the_way', 'arrived',
    'in_progress', 'completed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- The same trip from the driver's point of view.
do $$ begin
  create type driver_ride_status as enum (
    'assigned', 'accepted', 'on_the_way', 'arrived',
    'started', 'completed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- Where a single uploaded receipt stands in review.
do $$ begin
  create type proof_status as enum (
    'uploaded', 'under_review', 'verified', 'rejected'
  );
exception when duplicate_object then null; end $$;

-- Payout state. 'simulated_test' means a test-mode payout — not real money.
do $$ begin
  create type payout_status as enum (
    'pending', 'simulated_test', 'paid', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. A tiny helper so updated_at keeps itself current on every UPDATE.
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. The booking code generator.
--    These codes get shared over WhatsApp and typed by hand, so we skip
--    the look-alike characters (0/O, 1/I/L). Looks like: SM-7K3PQ9TM
-- ---------------------------------------------------------------------
create or replace function gen_booking_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L on purpose
  code text := '';
  i int;
begin
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return 'SM-' || code;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. profiles — one row per person.
--    Hangs off Supabase's auth.users and adds the bit the app cares about:
--    are you a passenger, a driver, or an admin? Plus contact details.
-- ---------------------------------------------------------------------
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  role            user_role   not null default 'passenger',
  full_name       text,
  mobile_number   text,
  whatsapp_number text,
  email           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 5. bookings — the heart of everything.
--    One row is one trip: where it's going, what it costs, where the
--    payment and the ride stand, and who's driving.
-- ---------------------------------------------------------------------
create table bookings (
  id                            uuid primary key default gen_random_uuid(),
  booking_code                  text unique not null default gen_booking_code(),
  user_id                       uuid references profiles(id) on delete set null, -- null = a guest booking

  -- The trip itself
  trip_type                     trip_type not null,
  airport_terminal              text,
  pickup_address                text,
  pickup_lat                    double precision,
  pickup_lng                    double precision,
  dropoff_address               text,
  dropoff_lat                   double precision,
  dropoff_lng                   double precision,
  pickup_datetime               timestamptz,
  passenger_count               int  default 1,
  luggage_count                 int  default 0,
  notes                         text,

  -- Who to contact. Kept right on the booking so guest bookings still work.
  passenger_name                text,
  passenger_mobile              text,
  passenger_whatsapp            text,
  passenger_email               text,

  -- The agreed price, frozen at booking time and never recalculated.
  fare_amount                   numeric(10,2) not null,
  currency                      text not null default 'SAR',

  -- Payment + where the booking is overall
  payment_method                payment_method not null default 'stcpay_manual',
  payment_status                payment_status not null default 'awaiting_proof',
  booking_status                booking_status not null default 'pending_payment',
  verification_mode             verification_mode,
  test_auto_verified_at         timestamptz,
  confirmed_at                  timestamptz,

  -- Who's driving, and how their part of the trip is going
  assigned_driver_id            uuid references profiles(id) on delete set null,
  driver_ride_status            driver_ride_status,

  -- ETAs — plain text for the MVP, filled in by hand for now
  scheduled_pickup_eta_text     text,
  payment_confirmation_eta_text text,
  driver_arrival_eta_minutes    int,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- Indexes for the lookups the app actually does (by user, driver, status, recency).
create index idx_bookings_user            on bookings (user_id);
create index idx_bookings_driver          on bookings (assigned_driver_id);
create index idx_bookings_booking_status  on bookings (booking_status);
create index idx_bookings_payment_status  on bookings (payment_status);
create index idx_bookings_created_at      on bookings (created_at desc);

create trigger bookings_set_updated_at
  before update on bookings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 6. payment_proofs — one row per uploaded STC Pay screenshot.
--    We store the file's path (the bytes live in private Storage) plus a
--    hash, so later we can catch the same receipt being re-used.
-- ---------------------------------------------------------------------
create table payment_proofs (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references bookings(id) on delete cascade,
  uploaded_by_user_id   uuid references profiles(id) on delete set null,
  file_url              text not null,          -- path in the PRIVATE bucket, not the file itself
  file_name             text,
  file_mime_type        text,
  file_size_bytes       bigint,
  file_hash             text,                   -- sha256, so a re-used receipt can be spotted
  status                proof_status not null default 'uploaded',
  verification_mode     verification_mode,
  admin_reviewer_id     uuid references profiles(id) on delete set null,
  reviewed_at           timestamptz,
  test_auto_verified_at timestamptz,
  rejection_reason      text,
  created_at            timestamptz not null default now()
);

create index idx_proofs_booking on payment_proofs (booking_id);
create index idx_proofs_hash     on payment_proofs (file_hash);

-- ---------------------------------------------------------------------
-- 7. payments — the record of money that actually came in.
-- ---------------------------------------------------------------------
create table payments (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references bookings(id) on delete cascade,
  provider            payment_provider not null default 'stcpay_manual',
  amount              numeric(10,2) not null,
  currency            text not null default 'SAR',
  status              payment_status not null default 'awaiting_proof',
  manual_reference    text,
  verified_by_admin_id uuid references profiles(id) on delete set null,
  verified_by_system  boolean not null default false,
  verification_mode   verification_mode,
  verified_at         timestamptz,
  notes               text,
  created_at          timestamptz not null default now()
);

create index idx_payments_booking on payments (booking_id);

-- ---------------------------------------------------------------------
-- 8. tracking_events — the trip's story, one line at a time.
--    This is what feeds the Grab-style timeline the passenger watches.
-- ---------------------------------------------------------------------
create table tracking_events (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references bookings(id) on delete cascade,
  event_type         text not null,   -- e.g. 'booking_created', 'proof_uploaded', 'auto_verified'
  title              text,
  message            text,
  created_by_user_id uuid references profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index idx_events_booking on tracking_events (booking_id, created_at);

-- ---------------------------------------------------------------------
-- 9. driver_locations — the breadcrumb trail of where a driver is.
--    Powers the moving car on the map and the live ETA.
-- ---------------------------------------------------------------------
create table driver_locations (
  id              uuid primary key default gen_random_uuid(),
  driver_id       uuid not null references profiles(id) on delete cascade,
  lat             double precision not null,
  lng             double precision not null,
  accuracy_meters double precision,
  recorded_at     timestamptz not null default now()
);

create index idx_driver_locations on driver_locations (driver_id, recorded_at desc);

-- ---------------------------------------------------------------------
-- 10. ledger_entries — who gets paid what, written when a trip finishes.
--     The platform's cut and the driver's take-home, all in one row.
-- ---------------------------------------------------------------------
create table ledger_entries (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references bookings(id) on delete cascade,
  driver_id           uuid references profiles(id) on delete set null,
  gross_fare          numeric(10,2) not null,
  platform_commission numeric(10,2) not null default 0,
  manual_payment_fee  numeric(10,2) not null default 0,
  driver_gross        numeric(10,2) not null default 0,
  driver_net          numeric(10,2) not null default 0,
  platform_net        numeric(10,2) not null default 0,
  payout_status       payout_status not null default 'pending',
  created_at          timestamptz not null default now()
);

create index idx_ledger_booking on ledger_entries (booking_id);
create index idx_ledger_driver  on ledger_entries (driver_id);

-- =====================================================================
-- 11. Row-Level Security — the safety net
-- =====================================================================
-- The short version: the backend uses the SERVICE ROLE key, which sails
-- right past these rules to do its trusted work. RLS is here to protect
-- you from everyone else — the public and ordinary logged-in users can
-- only ever read what's genuinely theirs. Anything sensitive (verifying
-- payments, assigning drivers, writing payouts) happens server-side with
-- the service role, never straight from a browser.
-- =====================================================================

alter table profiles         enable row level security;
alter table bookings         enable row level security;
alter table payment_proofs   enable row level security;
alter table payments         enable row level security;
alter table tracking_events  enable row level security;
alter table driver_locations enable row level security;
alter table ledger_entries   enable row level security;

-- A reusable "is this person an admin?" check. SECURITY DEFINER lets it
-- peek at profiles safely from inside the policies below.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- profiles: you can see and edit your own row; admins can see everyone.
create policy profiles_self_select on profiles
  for select using (id = auth.uid() or is_admin());
create policy profiles_self_update on profiles
  for update using (id = auth.uid());

-- bookings: you see your own, your assigned driver sees theirs, admins see all.
-- (Public tracking-by-code goes through the safe function further down, NOT a
--  public read policy — that's how we share a trip without leaking internal IDs.)
create policy bookings_owner_select on bookings
  for select using (
    user_id = auth.uid()
    or assigned_driver_id = auth.uid()
    or is_admin()
  );

-- Money tables (payments, proofs, ledger) are admin-only here. Drivers and
-- passengers get exactly what they need through dedicated server endpoints.
create policy payments_admin_select on payments
  for select using (is_admin());
create policy proofs_admin_select on payment_proofs
  for select using (is_admin());
create policy ledger_admin_select on ledger_entries
  for select using (is_admin());

-- tracking_events: visible to the people actually on that booking.
create policy events_related_select on tracking_events
  for select using (
    exists (
      select 1 from bookings b
      where b.id = tracking_events.booking_id
        and (b.user_id = auth.uid() or b.assigned_driver_id = auth.uid() or is_admin())
    )
  );

-- driver_locations: a driver only ever sees their own pings.
create policy driver_locations_self on driver_locations
  for select using (driver_id = auth.uid() or is_admin());

-- =====================================================================
-- 12. The public tracking function
-- =====================================================================
-- The tracking page needs to work for anyone holding a booking code, even
-- if they're not logged in — but without exposing internal UUIDs. So we
-- hand back ONLY the safe fields, looked up by code. Callable by anyone.
-- =====================================================================
create or replace function get_tracking_by_code(p_booking_code text)
returns table (
  booking_code               text,
  trip_type                  trip_type,
  airport_terminal           text,
  pickup_address             text,
  dropoff_address            text,
  pickup_datetime            timestamptz,
  fare_amount                numeric,
  currency                   text,
  payment_status             payment_status,
  booking_status             booking_status,
  verification_mode          verification_mode,
  scheduled_pickup_eta_text  text,
  payment_confirmation_eta_text text,
  driver_arrival_eta_minutes int,
  driver_full_name           text,
  driver_whatsapp_number     text,
  created_at                 timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    b.booking_code,
    b.trip_type,
    b.airport_terminal,
    b.pickup_address,
    b.dropoff_address,
    b.pickup_datetime,
    b.fare_amount,
    b.currency,
    b.payment_status,
    b.booking_status,
    b.verification_mode,
    b.scheduled_pickup_eta_text,
    b.payment_confirmation_eta_text,
    b.driver_arrival_eta_minutes,
    d.full_name,
    d.whatsapp_number,
    b.created_at
  from bookings b
  left join profiles d on d.id = b.assigned_driver_id
  where b.booking_code = p_booking_code
  limit 1;
$$;

grant execute on function get_tracking_by_code(text) to anon, authenticated;

-- =====================================================================
-- That's the foundation. Next file (0002) adds the driver-approval flag.
-- =====================================================================
