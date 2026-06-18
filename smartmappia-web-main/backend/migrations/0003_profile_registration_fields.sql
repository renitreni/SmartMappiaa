-- =====================================================================
-- Smart Mappia — Migration 0003: extended registration profile fields
-- For: Supabase / PostgreSQL 15+
--
-- Stores personal and driver application details collected at signup.
-- Safe to run more than once (uses IF NOT EXISTS).
-- =====================================================================

alter table profiles
  add column if not exists date_of_birth date,
  add column if not exists gender text,
  add column if not exists national_id text,
  add column if not exists vehicle_type text,
  add column if not exists vehicle_plate text;

  
