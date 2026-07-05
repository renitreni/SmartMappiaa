# Smart Mappia — Pick & Drop (single feature doc)

Consolidated source of truth for the Pick & Drop airport ride service: status, build
order, driver verification, mobile app, maps/routing, environment config, and database.
Replaces the old ROADMAP, DRIVER_VERIFICATION_ROADMAP, MOBILE_CAPACITOR, OSRM/maps notes,
and env notes. Operational runbooks stay separate: see
[SECURITY_TODO.md](SECURITY_TODO.md), [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md),
[SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md), [../HOSTING.md](../HOSTING.md),
[APP_BACKEND_UPDATES.md](APP_BACKEND_UPDATES.md), the deploy runbook
[DEPLOYMENT_LOG.md](DEPLOYMENT_LOG.md), the mobile build guide
[ANDROID_APP_GUIDE.md](ANDROID_APP_GUIDE.md), and the schema reference
[db/DATABASE_ERD.md](db/DATABASE_ERD.md). No emojis (project rule).

Status: **deployed to production** (smartmappia.com + api.smartmappia.com). Last updated: 1 July 2026.

## Contents
1. Status snapshot & build order
2. Architecture in three layers (tiles / routing / tracking)
3. Maps & routing (OSRM vs Google; pricing)
4. Driver verification (KYC) roadmap
5. Mobile app (Capacitor APK)
6. Environment variables (Cloud vs self-hosted Supabase)
7. Database (summary + link to ERD)
8. SQL not for production

---

## 1. Status snapshot & build order

| Area | Status |
|---|---|
| Pick & Drop booking + live tracking | LIVE in production |
| Payment: manual STC Pay + admin verify | LIVE; online gateway (Tap) deferred, flag off |
| Driver verification (KYC) | LIVE (upload + admin review + auto-approve gate) |
| Data collection / analytics | schema applied; basic Reports + CSV done |
| Notifications | web chime + toast done; token endpoints live; native push (FCM) todo |
| Hostinger + OSRM | LIVE (VPS + self-hosted OSRM proxied at /api/osrm) |
| Supabase migration (standalone) | done |
| Capacitor Android app | todo — full build guide: [ANDROID_APP_GUIDE.md](ANDROID_APP_GUIDE.md) |
| Security / launch gates | in progress (rotate service_role, remove test accounts) |

**Build order:**
1. Hostinger VPS + self-hosted OSRM (`/api/route`) + `api.smartmappia.com`.
2. Standalone Supabase + migrations (0001-0003, 0005-0008, skip 0004) + private buckets + verify RLS + Pro.
3. Driver verification (0005 + `driver-docs` bucket + endpoints + UIs; re-enable approval gate).
4. Analytics richer (0007 + per-order-type reports).
5. Notifications native (0008 + push).
6. Tap Payments backend (when the merchant API is live).
7. Capacitor APK.
8. Security / launch gates — applied throughout; final pass before go-live.

---

## 2. Architecture in three layers

A "Grab-like" map screen is three independent pieces — mix and match:

| Layer | What it is | Now | Grab-like upgrade |
|---|---|---|---|
| 1. Base map tiles (2D) | The map picture | CARTO raster via Leaflet (`frontend/src/portal/components/RideMap.jsx:17`) | Vector tiles (MapTiler / Mapbox / Google) |
| 2. Routing | Road line + distance/ETA | OSRM (`frontend/src/portal/lib/osrm.js`) | Google Routes API (traffic-aware) |
| 3. Live tracking | Moving the driver dot | Supabase Realtime (working) | (no change needed) |

Key point: OSRM does layer 2 only — it does not provide tiles and does not track anything.
Live tracking already works via Supabase Realtime broadcast (backend `lib/realtime.js` pushes
over HTTP; browser subscribes over WebSocket in `frontend/src/portal/lib/useBroadcast.js`),
with an 8s polling fallback on the tracking page. No custom WebSocket/Redis server needed.

---

## 3. Maps & routing (OSRM vs Google)

OSRM = free, self-hosted, static road speeds (no live traffic). Verified working (public demo
returns HTTP 200 + valid route). For production, self-host and point `VITE_OSRM_BASE` at it
(see build order step 1 + [../HOSTING.md](../HOSTING.md)); the public demo is rate-limited and
not for production.

Google Routes API = paid, traffic-aware ETAs (the real Grab feature).
Endpoint: `POST https://routes.googleapis.com/directions/v2:computeRoutes`.
Docs: https://developers.google.com/maps/documentation/routes

### Google Routes API pricing (per 1,000 requests; tiers = volume bands)

| SKU | SKU ID | Free/mo | T1 | T2 | T3 | T4 | T5 |
|---|---|---|---|---|---|---|---|
| Compute Routes Essentials (no traffic) | 9EFF-679A-9B16 | 10,000 | $5.00 | - | - | - | $0.38 |
| Compute Routes Pro (traffic-aware) | 02F7-1B55-DC90 | 5,000 | $10.00 | $8.00 | $6.00 | $3.00 | $0.75 |
| Compute Routes Enterprise | 6EBD-08E5-319A | 1,000 | $15.00 | - | - | - | $1.14 |
| Roads - Nearest Road | 6108-C697-9EA5 | 5,000 | $10.00 | $8.00 | $6.00 | $3.00 | $0.76 |
| Roads - Route Traveled | 9806-C277-BCCA | 5,000 | $10.00 | $8.00 | $6.00 | $3.00 | $0.76 |
| Roads - Speed Limits | BC44-A4CC-322A | 5,000 | $20.00 | $16.00 | $12.00 | $12.00 | $12.00 |
| RouteOptimization - SingleVehicleRouting | 2020-AA6E-7D49 | 5,000 | $10.00 | $4.00 | $2.00 | $0.80 | $0.70 |

Notes: **Compute Routes Pro** is the one for Grab-style traffic ETAs. **Roads - Speed Limits**
is expensive/flat (only if we truly need it). **Roads APIs** = Google's map-matching (same job
OSRM `/match` does free). **RouteOptimization** = multi-stop fleet planning (not needed for A->B).
If we go Google: proxy calls through the backend (keep the key off the public bundle) and keep the
existing coordinate rounding / refetch-only-on-leg-change caching in `osrm.js`. Tiles (layer 1) and
routing (layer 2) bill separately; mixing free CARTO tiles + Google routing is allowed.

Verdict: OSRM works today. For launch we only need to self-host OSRM (off the public demo) and
optionally upgrade layer-1 tiles for the look. Paid Google routing is only worth it once we
specifically want live-traffic ETAs.

---

## 4. Driver verification (KYC) roadmap

During the pilot, driver approval is disabled: any signed-up driver is auto-approved. The DB
migration `0004` was NOT applied (so `profiles.driver_approved` default is `false`); the
auto-approve happens in code at `backend/controllers/authController.js` (the line forcing
`driverApproved = true` for drivers/admins). Before public launch, drivers must upload documents
and an admin must approve them.

### Target production policy
- Verified drivers (documents uploaded + approved) can accept rides and automatically receive
  available rides — no per-ride admin action. The one-time document check is the only gate.
- Non-verified drivers are blocked at `requireApprovedDriver`: the feed returns nothing, and
  accept/location endpoints reject them.

### Required documents (KSA — confirm exact list with TGA / compliance)
National ID or Iqama; Saudi driving license (with expiry); vehicle registration (Istimara);
vehicle insurance; TGA ride-hailing permit (if required); driver profile photo; vehicle photo +
plate. Capture an expiry date where applicable to flag renewals.

### Reuse (this is mostly assembly)
- Extended profile fields already exist (`0003`: `national_id`, `vehicle_type`, `vehicle_plate`).
- The approval gate already exists (`requireApprovedDriver` + `driver_approved`).
- Admin approve/reject UI + endpoint exist (`AdminPage.jsx` Drivers tab; `POST /api/admin/drivers/:driverId/approval`).
- The payment-proof upload/review flow is the exact pattern to copy for documents (signed-URL issue
  + record row + private bucket + admin review).

### Build checklist
1. Data model — migration `0005`: `driver_documents` table (id, driver_id, doc_type enum,
   storage_path, file_name, mime_type, expiry_date, status, rejection_reason, reviewed_by_admin_id,
   reviewed_at, created_at) + `profiles.driver_verification_status` (none/submitted/approved/rejected).
2. Storage — private `driver-docs` bucket; RLS so a driver reads only their own docs, admins read all.
3. Backend — `POST /api/driver/documents/signed-url`, `POST /api/driver/documents`,
   `GET /api/driver/documents`, `GET /api/admin/drivers/:driverId/documents`; extend approval so it
   requires all required doc types `verified`.
4. Driver UI — a Verification step at/after sign-up (reuse the upload component from `BookPage.jsx`);
   pending + rejection screens.
5. Admin UI — Drivers tab shows each pending driver's documents (thumbnails + expiry) with
   per-document Verify/Reject, then overall Approve; surface expiring/expired docs.
6. Re-enable the gate — revert the auto-approve line in `authController.js` to
   `role === 'admin' ? true : (existing ? existing.driver_approved : false)`; keep default `false`;
   confirm `requireApprovedDriver` still guards `/available`, `/accept`, `/location`.

Phasing: collect (model + storage + upload UI) -> review (admin viewer + verify/reject) -> enforce
(re-enable gate) -> maintain (expiry tracking, renewal reminders, auto-suspend on expiry).

Definition of done: a new driver cannot reach the feed until approved; approval needs every
required doc uploaded + verified; docs live in a private bucket (owner + admins only); expired docs
flag re-verification; `DOCUMENTATION.md` + `docs/PILOT.md` reflect the document-based flow.

---

## 5. Mobile app (Capacitor APK)

> Full, developer-ready build instructions live in
> **[ANDROID_APP_GUIDE.md](ANDROID_APP_GUIDE.md)** (prerequisites, Capacitor steps, native
> geolocation/push, payment deep links, backend connection, and the full API reference). The
> summary below is the decision + recipe outline.

Decision: wrap the existing web app with Capacitor -> Android APK (no separate mobile codebase).
Build it AFTER Hostinger so it is built once against the final backend and never needs a rebuild.
App identity: appId `com.smartmappia`, name "Smart Mappia", Android only for now. Target the stable
domain `https://api.smartmappia.com` so host moves are invisible to the app (see
[APP_BACKEND_UPDATES.md](APP_BACKEND_UPDATES.md)).

Already done so the build is easy: all API calls go through `VITE_API_BASE`; OSRM base is
`VITE_OSRM_BASE`; Vite outputs to `dist`; geolocation centralized in `geo.js` (`useGeolocation`).

Build recipe (when Hostinger is ready):
1. Stand up `api.smartmappia.com` (DNS + custom domain + HTTPS).
2. In `frontend/`, add `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`,
   `@capacitor/geolocation` (+ optionally `@capacitor/app`, `@capacitor/browser`).
3. `npx cap init "Smart Mappia" com.smartmappia --web-dir dist`.
4. Native geolocation: in `geo.js`, when `Capacitor.isNativePlatform()` use `@capacitor/geolocation`
   (get/watch + permission), fall back to `navigator.geolocation` on web; keep the `useGeolocation`
   signature. Add `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` to AndroidManifest.
5. Build web with prod env (`VITE_API_BASE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional
   `VITE_OSRM_BASE`) -> `npm run build` -> `npx cap add android` -> `npx cap sync`.
6. Build the APK in Android Studio (or `./gradlew assembleDebug`). Requires Android SDK + JDK.

Watch-items: `BrowserRouter` works in the webview (switch to `HashRouter` only if nav misbehaves);
all endpoints HTTPS (no cleartext issue); backend CORS must allow the app origin; payment redirect
(later) via `@capacitor/browser` + deep link with the webhook as source of truth; native push later.

---

## 6. Environment variables (Cloud vs self-hosted Supabase)

Golden rule: **ANON key -> frontend only. SERVICE ROLE key -> backend only. Never swap them.**
`VITE_*` vars are compiled into the browser bundle at build time, so anything `VITE_*` is public;
after changing a `VITE_*` value you must rebuild the frontend.

| Variable | File | Service | Notes |
|---|---|---|---|
| `VITE_API_BASE` | frontend/.env | Frontend | Backend URL, e.g. `https://api.smartmappia.com` |
| `VITE_SUPABASE_URL` | frontend/.env | Frontend | Supabase URL (matches backend `SUPABASE_URL`) |
| `VITE_SUPABASE_ANON_KEY` | frontend/.env | Frontend | ANON/public key only (must decode to role `anon`) |
| `VITE_OSRM_BASE` | frontend/.env | Frontend | Self-hosted OSRM, e.g. `https://api.smartmappia.com/osrm/route/v1/driving` |
| `VITE_TAP_ENABLED` | frontend/.env | Frontend | `false` -> "Pay online (coming soon)", manual STC Pay only |
| `SUPABASE_URL` | backend/.env | Backend | Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | backend/.env | Backend | SERVICE ROLE secret — never in frontend |
| `PAYMENT_MODE` | backend/.env | Backend | Label; `stcpay_manual` for manual only |
| `AUTO_VERIFY_STCPAY_TEST_MODE` | backend/.env | Backend | MUST be `false` in production |
| `CORS_ORIGINS` | backend/.env | Backend | Prod frontend origin(s) |
| `ADMIN_EMAILS` | backend/.env | Backend | Auto-admin accounts |

### Option A - Supabase Cloud (current)
Values from dashboard: Settings -> API. Frontend gets the URL + **anon** key; backend gets the URL +
**service_role** key.

### Option B - Self-hosted Supabase on the Hostinger VPS
Run the official Supabase docker-compose on the VPS. Same variable names, different values: URL is
your own domain (e.g. `https://supabase.smartmappia.com`, Kong gateway); the ANON and SERVICE_ROLE
keys are the JWTs from the self-host `docker/.env`. Gotchas:
- The `realtime` container must be running + reachable through Kong (it powers live driver tracking).
- The self-host `JWT_SECRET` must match the secret the keys were signed with, or auth rejects everything.
- Recreate the private `payment-proofs` (and later `driver-docs`) buckets — they do not carry over.
- Run all migrations against the self-hosted Postgres (a fresh self-host has none of the tables).
- Point DNS at the VPS and put it behind Nginx + Let's Encrypt SSL.

### Switching Cloud <-> self-host
Only 4 values move (names never change): `VITE_SUPABASE_URL`+`SUPABASE_URL` (matching), the ANON key,
the SERVICE_ROLE key. Then re-run migrations, recreate buckets, and rebuild the frontend.

---

## 7. Database (summary)

Full column-level schema, ERD (Mermaid), enums, RLS model, and migration provenance live in
[db/DATABASE_ERD.md](db/DATABASE_ERD.md). Quick summary:

- Core tables (0001-0003, live): `profiles`, `bookings`, `payment_proofs`, `payments`,
  `tracking_events`, `driver_locations`, `ledger_entries`.
- Planned tables: `driver_documents` (0005), `webhook_events` (0006), `device_push_tokens` +
  `notification_events` (0008).
- `bookings.booking_code` is generated by `gen_booking_code()` (31-char unambiguous alphabet x 8 =
  ~40 bits, unique). Adequate entropy; combined with the lookup rate limiter, enumeration is
  infeasible. Optional future hardening: switch to `gen_random_bytes()` for crypto-grade codes.
- Security: RLS is enabled on every table with owner/driver/admin policies + `is_admin()`. The
  backend uses the service_role key (bypasses RLS for trusted work); browsers use the anon key and
  can only read what is theirs. Public tracking goes through `get_tracking_by_code()`
  (SECURITY DEFINER) which returns only safe fields by code.

---

## 8. SQL not for production
`backend/migrations/0004_auto_approve_drivers.PILOT.sql` is PILOT ONLY (auto-approves every driver).
Production applies `0001, 0002, 0003, 0005, 0006, 0007, 0008` and SKIPS `0004`. In this project's
current Supabase, 0004 was never applied (confirmed via the column default), so no reversal is
needed — but the code-side auto-approve in `authController.js` still must be reverted at launch
(see section 4).
