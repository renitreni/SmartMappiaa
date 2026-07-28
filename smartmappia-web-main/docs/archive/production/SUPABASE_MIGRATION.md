# Migrating Supabase off Vercel (to a standalone account)

## Why

The current Supabase project was provisioned through the **Vercel Marketplace**, so its billing is
managed by Vercel ("Organization plans are managed by Vercel Marketplace" on the plan screen, and
Pro upgrades route through Vercel). We are moving app hosting to Hostinger and want **no Vercel
dependency**, so we re-provision the database on a Supabase account billed directly by Supabase,
then upgrade *that* project to Pro.

App hosting and the database are independent: the app reaches Supabase only by URL + keys, so this
migration is just "stand up a fresh Supabase project and point the app at it." Do it **now**, while
pre-production — there is essentially only test data to lose, and it gets harder once real pilot
data exists.

> If your Supabase org settings show a "transfer / detach from Vercel" option, using it avoids the
> re-provisioning below. The steps here always work regardless.

## Steps

### 1. Create a standalone Supabase project
- Sign up / sign in at **supabase.com directly** (NOT via Vercel), on an org with direct Supabase billing.
- New project. Pick the region closest to Riyadh that's offered (e.g. Bahrain `me-south-1`, else
  Frankfurt `eu-central-1`). Set and save a strong database password.

### 2. Create the schema
In the new project: **SQL Editor**, run these in order (copy/paste each file, Run):
1. `backend/migrations/0001_init_smart_mappia.sql`
2. `backend/migrations/0002_auth_driver_approval.sql`
3. `backend/migrations/0003_profile_registration_fields.sql`
4. `backend/migrations/0004_auto_approve_drivers.PILOT.sql` — **pilot only**. Run it for the pilot so
   drivers are auto-approved; **skip it for the real production launch** (see
   [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) and [PICK_AND_DROP.md](PICK_AND_DROP.md) section 4).

#### Planned migrations (0005–0008)

These add the upcoming features (driver verification, the Tap payment gateway, data-collection
columns, and notifications). They are **safe to apply now** — all use `IF NOT EXISTS` / guarded
enum creation, and every new column has a constant default, so on Postgres 15 they apply as
metadata-only (no table rewrite, no long lock). Run them **in order**, each as its own paste in the
SQL Editor (do not wrap them in a `BEGIN…COMMIT`):

5. `backend/migrations/0005_driver_verification.sql` — `driver_documents` table + `profiles.driver_verification_status`.
   **Requires the `driver-docs` bucket (step 3) for uploads to work**; the SQL itself applies fine without it.
6. `backend/migrations/0006_payment_gateway.sql` — Tap gateway columns, `webhook_events`, and the `'tap'` /
   `'gateway_webhook'` enum values. Schema only — Tap stays feature-flagged off until you build the
   endpoints (see "Tap Payments go-live" below). Its `ALTER TYPE … ADD VALUE` lines must run as their
   own statements (the SQL Editor does this), never in a transaction that also *uses* the new value.
7. `backend/migrations/0007_data_collection.sql` — `order_type` enum, booking snapshot columns, the `booking_report_v`
   view, and a new prefixed booking-code default (`SM-PD-…`). Existing rows are untouched. Verified safe:
   no code validates the booking-code format, so the new prefix breaks nothing.
8. `backend/migrations/0008_notifications.sql` — `device_push_tokens` + `notification_events`. No prerequisites.

> No PITR/backup on the Free tier. Before running these on a database with data you care about, take a
> manual dump (`pg_dump "<CONNECTION_STRING>" > backup.sql`). Each migration file also has reversal
> notes at the bottom if you need to undo a step by hand.

### 3. Create the storage buckets
- **Storage → New bucket** → name it exactly `payment-proofs` → leave it **Private** (uncheck public).
  (This is the default name; if you override `PAYMENT_PROOF_BUCKET`, match it.)
- For driver verification (migration `0005`), also create a second **Private** bucket named exactly
  `driver-docs`. Buckets can't be created from SQL — this Dashboard step is required before drivers
  can upload documents.

### 4. Grab the new credentials
From **Settings → API**:
- Project URL
- `anon` public key
- `service_role` secret key (backend only — never ship this to the frontend)

### 5. Update env vars
`backend/.env`:
```
SUPABASE_URL=<new project URL>
SUPABASE_SERVICE_ROLE_KEY=<new service_role key>
ADMIN_EMAILS=<your admin email(s)>
# keep the rest as-is for the pilot (AUTO_VERIFY_STCPAY_TEST_MODE, STC Pay, etc.)
```
`frontend/.env`:
```
VITE_SUPABASE_URL=<new project URL>
VITE_SUPABASE_ANON_KEY=<new anon key>
VITE_API_BASE=<your backend URL>
```
Apply the same values on Hostinger (VPS `.env` for the backend; rebuild the frontend with its
`.env` so the new URL/anon key are baked into `dist/`).

### 6. Verify the new database
From `backend/`:
```
npm run check:migrations
```
Expect all migrations to pass. (To also confirm every table + the bucket, re-run the table/bucket check
used during setup.)

### 7. Seed accounts
```
cd backend
npm run seed:accounts   # admin123 / user123 / driver123 (override via *_SEED_* env vars)
```
Or just sign up fresh accounts.

### 8. (Only if you have data worth keeping) migrate data
For a pre-production pilot this is usually unnecessary — just re-seed. If you must move existing
rows/users, use Postgres dump + restore with the connection strings from **Settings → Database** of
each project:
```
pg_dump --data-only --no-owner "<OLD_CONNECTION_STRING>" > data.sql
psql "<NEW_CONNECTION_STRING>" < data.sql
```
Note: Supabase Auth users live in the `auth` schema; if real users exist, migrate them with
Supabase's documented auth-export/import (or have pilot testers re-sign up).

### 9. Upgrade the new project to Pro
- New project → **Settings → Billing → upgrade to Pro** (billed by Supabase directly, no Vercel).

### 10. Cut over and decommission
- Point Hostinger at the new project (steps 5), restart the backend (PM2) and redeploy the
  frontend build.
- Smoke-test the full flow (sign up, book, upload proof, driver accept, track) against the new project.
- Once confirmed, delete the **Vercel-managed Supabase project** and the Vercel project to stop
  that billing. Keep the old project until you have verified the new one.

## Rollback
Until step 10's smoke test passes, the old Vercel-linked project is untouched — revert by switching
the env vars back to the old URL/keys.

## Tap Payments go-live

Migration `0006` already lays **all** the database side (the `payments.gateway_*` columns, the
`webhook_events` table, and the `'tap'` / `'gateway_webhook'` enum values). **There is no second
migration to run when Tap goes live** — turning it on is application + config work, not SQL:

1. **Tap onboarding** — obtain the API **secret key** and the **webhook signing secret**.
2. **Config/env** — add the Tap keys to `backend/lib/config.js` + env vars (none exist yet).
3. **Build `POST /api/payments/:code/tap-charge`** — creates a Tap Charge, writes a `payments` row
   with `provider='tap'`, `gateway_payment_id`, `gateway_status`, `gateway_raw`, and returns the
   hosted `redirectUrl`.
4. **Build the Tap webhook endpoint** — verify the signature, log the raw callback into
   `webhook_events`, look the payment up by `gateway_payment_id`, and on success run the confirm flow
   with `verification_mode='gateway_webhook'`. The webhook is the source of truth, not the redirect.
5. **Generalize `verifyBookingPayment()`** in `backend/lib/payments.js` (today it hardcodes
   `provider: 'stcpay_manual'`) to add the gateway path.
6. **Frontend** — add `api.createTapCharge()` and flip `VITE_TAP_ENABLED=true`
   (see `frontend/src/components/booking/TapPayButton.jsx`).
7. **Test in Tap's sandbox**, then swap to live keys.

## Related
- [HOSTING.md](../HOSTING.md) — Hostinger stack + deployment checklist.
- [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) — the two flags to flip before real launch.
