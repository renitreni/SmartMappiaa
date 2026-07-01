-- =====================================================================
-- Smart Mappia — Migration 0005: driver verification (document-based)
-- For: Supabase / PostgreSQL 15+
--
-- Lets drivers upload the paperwork that gets them on the road — national
-- ID, license, vehicle registration, insurance, TGA permit, and a couple
-- of photos. Each document is reviewed by an admin (pending -> verified
-- or rejected). The driver's overall verification standing is mirrored
-- onto their profile so the app can gate features without joining tables.
--
-- The actual files live in a PRIVATE Supabase Storage bucket named
-- `driver-docs`, which you create in the Dashboard (Storage -> New bucket,
-- keep it private) — buckets aren't created from SQL. Only the storage
-- PATH and a hash are stored here.
--
-- To run it: Supabase Dashboard -> SQL Editor -> paste this in -> Run.
-- Safe to run again (uses IF NOT EXISTS and guarded enum creation).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The document vocabulary.
--    Postgres has no "create type if not exists", so we wrap each one in
--    a DO block that swallows duplicate_object — that's what makes it
--    safe to re-run.
-- ---------------------------------------------------------------------
do $$ begin
  create type driver_doc_type as enum (
    'national_id', 'license', 'vehicle_registration',
    'insurance', 'tga_permit', 'profile_photo', 'vehicle_photo'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type driver_doc_status as enum ('pending', 'verified', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type driver_verification_status as enum ('none', 'submitted', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. driver_documents — one row per uploaded document.
--    Like payment_proofs, we keep the storage path + a hash (so the same
--    file being re-used can be spotted), never the bytes themselves.
-- ---------------------------------------------------------------------
create table if not exists driver_documents (
  id                    uuid primary key default gen_random_uuid(),
  driver_id             uuid not null references profiles(id) on delete cascade,
  doc_type              driver_doc_type not null,
  storage_path          text not null,          -- path in the PRIVATE `driver-docs` bucket
  file_name             text,
  mime_type             text,
  file_size_bytes       bigint,
  file_hash             text,                   -- sha256, so a re-used file can be spotted
  expiry_date           date,                   -- e.g. license/insurance expiry
  status                driver_doc_status not null default 'pending',
  rejection_reason      text,
  reviewed_by_admin_id  uuid references profiles(id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Indexes for the lookups the app does: a driver's docs by status, soon-to-
-- expire docs, and dedupe-by-hash checks.
create index if not exists idx_driver_documents_driver_status
  on driver_documents (driver_id, status);
create index if not exists idx_driver_documents_driver_expiry
  on driver_documents (driver_id, expiry_date);
create index if not exists idx_driver_documents_hash
  on driver_documents (file_hash);

-- Keep updated_at current on every UPDATE (reuses the shared helper).
drop trigger if exists driver_documents_set_updated_at on driver_documents;
create trigger driver_documents_set_updated_at
  before update on driver_documents
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- 3. Row-Level Security.
--    The backend uses the SERVICE ROLE key and bypasses all of this. The
--    rules below are for ordinary logged-in drivers and admins.
-- ---------------------------------------------------------------------
alter table driver_documents enable row level security;

-- A driver manages their own documents; admins can read everyone's.
drop policy if exists driver_documents_self_select on driver_documents;
create policy driver_documents_self_select on driver_documents
  for select using (driver_id = auth.uid() or is_admin());

drop policy if exists driver_documents_self_insert on driver_documents;
create policy driver_documents_self_insert on driver_documents
  for insert with check (driver_id = auth.uid());

drop policy if exists driver_documents_self_update on driver_documents;
create policy driver_documents_self_update on driver_documents
  for update using (driver_id = auth.uid());

-- ---------------------------------------------------------------------
-- 4. Mirror the overall verification standing onto the profile.
--    Everyone starts at 'none' and moves to 'submitted' once they upload,
--    then 'approved'/'rejected' after an admin reviews the set.
-- ---------------------------------------------------------------------
alter table profiles
  add column if not exists driver_verification_status driver_verification_status not null default 'none';

-- =====================================================================
-- Reversal notes (if you ever need to roll back):
--   drop table if exists driver_documents;
--   alter table profiles drop column if exists driver_verification_status;
--   -- enums (driver_doc_type, driver_doc_status, driver_verification_status)
--   -- can be dropped with `drop type if exists ...` once nothing references them.
-- The `driver-docs` Storage bucket must be removed from the Dashboard.
-- =====================================================================
