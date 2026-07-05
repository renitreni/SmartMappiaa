# Smart Mappia — Pick & Drop: Complete Handbook (Standalone)

A single, self-contained reference for the Smart Mappia Pick & Drop system: what was built
(frontend + backend), how it is deployed, how payments work (STC Pay + Tap), driver verification,
live tracking, the full API, and how to build the Android app with Capacitor. This document does not
reference any other file — it is meant to be exported to PDF and handed to a developer.

Last updated: 1 July 2026. Status: deployed to production.

- Website: https://smartmappia.com
- API: https://api.smartmappia.com
- Repository: https://github.com/Rizzkkk/SmartMappiaa (branch `full`)

---

## 1. What Smart Mappia is

Smart Mappia is an airport **Pick & Drop** ride service for Riyadh (Grab-style). A passenger books
a ride, pays by STC Pay (manual proof + admin verification), a nearby approved driver accepts, and
the passenger tracks the driver live on a map. There are three roles: **passenger (rider)**,
**driver**, and **admin**.

The whole product is a **web app** (React) talking to a **Node/Express API** backed by **Supabase**
(Postgres + Auth + Storage + Realtime), with **self-hosted OSRM** for road routing. The **Android
app** is the same web app wrapped with **Capacitor** — there is no separate mobile codebase.

---

## 2. Tech stack

- **Frontend:** React 19 + Vite + Tailwind. Maps via Leaflet with CARTO/OpenStreetMap tiles.
  Supabase JS client for auth, realtime, and file uploads.
- **Backend:** Node.js 20 + Express (plain JavaScript, CommonJS). Runs under PM2 behind Nginx with
  Let's Encrypt HTTPS on a Hostinger VPS.
- **Database/Auth/Storage/Realtime:** Supabase (standalone project, Postgres 15).
- **Routing engine:** OSRM (Open Source Routing Machine) in Docker on the VPS, bound to localhost
  and exposed only through the backend at `/api/osrm`.
- **Mobile:** Capacitor (Android) wrapping the built web app.

---

## 3. Architecture

```
 Android app (Capacitor WebView)  ─┐
 Web browser (smartmappia.com)    ─┼── HTTPS ──►  api.smartmappia.com  (Express, PM2, Nginx)
                                   │                    ├─ Supabase (Postgres + Auth + Storage + Realtime)
                                   │                    └─ OSRM (Docker, 127.0.0.1:5000) via /api/osrm
 Supabase Realtime (WebSocket) ◄───┘   live driver-location broadcast
```

A map screen is three independent layers:
1. **Base map tiles (2D):** the map picture — CARTO raster tiles via Leaflet.
2. **Routing:** the road line + distance/ETA — OSRM (self-hosted).
3. **Live tracking:** the moving driver dot — Supabase Realtime Broadcast (not OSRM).

Live tracking flow: the driver app sends GPS every ~12s to `POST /api/driver/location`; the backend
stores it and broadcasts the new position to the passenger's map over a Supabase Realtime channel;
the passenger page also polls every 8s as a fallback. No custom WebSocket/Redis server is needed —
Supabase provides the realtime layer.

---

## 4. Roles, accounts, and authentication

- Authentication is **Supabase Auth** (email + password). After login the client holds a session and
  sends `Authorization: Bearer <access_token>` on every API call. The backend verifies the token and
  reads the role from the `profiles` table.
- **Passenger** — the default role on signup. Must be logged in to book.
- **Driver** — chosen at signup. Starts **unapproved**; must upload verification documents and be
  approved by an admin before seeing the ride feed or accepting rides.
- **Admin** — never selectable at signup and never self-assignable via the API. An account becomes
  admin **only** if its email is listed in the backend `ADMIN_EMAILS` environment variable (or it
  already has an admin profile). This is the entire admin-access control.

Booking is enforced at three layers: the booking API requires a valid token; the API client attaches
the token automatically; and the `/book` route is guarded so a signed-out user is redirected to login.

---

## 5. What was built — Frontend

- **Marketing site** plus three role-gated portals: rider, driver, admin.
- **Booking** (login-gated): trip type (house↔airport), pickup/dropoff, schedule, passenger details;
  a fare snapshot is created server-side.
- **Payment (manual STC Pay):** the pay screen shows the Smart Mappia STC Pay number and fare; the
  passenger uploads a payment screenshot which goes straight to private storage via a signed URL.
- **Live tracking screen:** map with the moving driver marker, ETA, and a status timeline; in-app
  chime + toast when the driver is on the way / has arrived.
- **Driver portal:** availability toggle, the open ride feed, accept, live GPS sharing, ride status
  progression.
- **Driver verification (KYC) screen:** unapproved drivers see an upload screen (not the feed) to
  submit each required document, view each document's status (Under review / Verified / Rejected with
  reason), and re-upload rejected ones.
- **Admin portal:** dashboard/stats, bookings list with payment **verify/reject**, driver approval,
  and a **document review** panel per driver (view each document, Verify/Reject; the driver is
  auto-approved once all required documents are verified). Reports tab with CSV export.
- **Company/contact info** is centralized in one config file (used by the footer and the legal
  privacy/terms modals): address, email, phone, WhatsApp, website.
- **Online payment (Tap)** button is present but behind a feature flag (off) — it shows
  "Pay online — coming soon" until the Tap backend is live.

Frontend environment variables (compiled into the build; the app must be rebuilt after any change):

```
VITE_API_BASE=https://api.smartmappia.com
VITE_SUPABASE_URL=<supabase project url>
VITE_SUPABASE_ANON_KEY=<supabase ANON/public key>     # never the service_role key
VITE_OSRM_BASE=https://api.smartmappia.com/api/osrm/route/v1/driving
VITE_TAP_ENABLED=false                                  # true only when the Tap backend is live
```

Golden rule: anything `VITE_*` is public (it ships in the browser/app bundle). Only the Supabase
**anon** key belongs in the frontend; the **service_role** key stays on the backend.

---

## 6. What was built — Backend

Node/Express API. Security: Helmet headers, env-configurable CORS, central error handling (no raw DB
errors leaked), per-endpoint rate limiting, and `trust proxy` enabled so rate limits key on the real
client IP behind Nginx. All data access uses Supabase; the backend uses the **service_role** key
(bypasses row-level security) for trusted server-side work.

Key modules: booking + fare, payments state machine (STC Pay manual / test-auto / gateway-webhook),
tracking events, driver matching (Haversine distance + ETA), ledger/payout math, Supabase Realtime
broadcast helpers, storage signed-URL helpers (payment proofs + driver documents), and the OSRM
proxy.

Row-Level Security (RLS) is enabled on every table with owner/driver/admin policies. Browsers/apps
use the anon key and can only read their own data; public trip tracking goes through a
security-definer function that returns only safe fields by booking code (never internal IDs).

---

## 7. Payments (read carefully)

### 7a. STC Pay — MANUAL (the live, working method)
There is no card gateway in use. The passenger pays via their own STC Pay app and uploads a proof
screenshot; an admin verifies it. The flow:

1. `GET /api/bookings/:code/payment-instructions` returns the Smart Mappia STC Pay **number**
   (currently `0553476619`), the recipient name, and the fare in SAR (base 100 + 3.75% service fee
   = 103.75).
2. The passenger transfers that amount to the number via STC Pay.
3. The passenger uploads the proof screenshot:
   - `POST /api/bookings/:code/payment-proof/signed-url` with `{ file_name, mime_type }` returns a
     signed upload URL + token + bucket + path.
   - The file is uploaded directly to Supabase Storage (private `payment-proofs` bucket) using that
     signed URL — it never passes through the server.
   - `POST /api/bookings/:code/payment-proof` with `{ path, file_name, mime_type, size_bytes }`
     records it; the booking moves to `payment_under_review`.
4. An **admin** verifies the proof in the admin portal; the booking becomes `confirmed` and is
   published to drivers. (In production `AUTO_VERIFY_STCPAY_TEST_MODE` is `false`, so a human must
   verify — there is no auto-approval.)

Accepted proof files: `image/jpeg`, `image/png`, `image/webp`, or `application/pdf`, up to 10 MB. On
mobile, allow gallery or camera capture.

### 7b. Tap Payments — ONLINE gateway (deferred; schema ready, backend not built)
Not live yet. The database schema exists (a `tap` payment provider, `gateway_*` columns on payments,
a `gateway_webhook` verification mode, and a `webhook_events` audit table), and the frontend has a
flag-gated "Pay online" button, but the backend endpoints are not implemented. When it is turned on:

- The backend will expose `POST /api/payments/:code/tap-charge`, which creates a Tap charge and
  returns a hosted payment URL (`transaction.url`).
- The app opens that URL (in the mobile app via an in-app browser), the user pays by STC Pay / mada /
  card through Tap, and returns to the app via a deep link.
- A **Tap webhook** (with signature verification, logged to `webhook_events`) is the source of truth
  that confirms the booking — the app must not treat the redirect alone as success.
- Backend-only environment variables required when enabling it: `TAP_SECRET_KEY`, `TAP_PUBLIC_KEY`,
  `TAP_WEBHOOK_SECRET`, `TAP_MERCHANT_ID`. Then set `VITE_TAP_ENABLED=true` and rebuild the frontend.

For the mobile app: build so the "Pay online" button is easy to enable later (browser open + deep
link return), but manual STC Pay is the only working path today.

---

## 8. Driver verification (KYC) — live

A new driver signs up, is unapproved, and sees the verification screen instead of the ride feed. The
driver uploads each required document; an admin reviews each; once all required documents are
verified the driver is auto-approved and can go online.

Required document types: `national_id` (National ID / Iqama), `license` (driving license),
`vehicle_registration` (Istimara), `insurance`, `profile_photo`, `vehicle_photo` (+ `tga_permit`
optional). Files go to a private `driver-docs` storage bucket via signed URLs, exactly like payment
proofs. An expiry date can be captured per document for renewal tracking.

Driver endpoints: `POST /api/driver/documents/signed-url`, `POST /api/driver/documents`,
`GET /api/driver/documents`. Admin endpoints: `GET /api/admin/drivers/:id/documents`,
`POST /api/admin/drivers/:id/documents/:docId/review`.

---

## 9. Notifications

- **In-app web notifications** (chime + toast on driver on-the-way / arrived) work today, including
  inside the Android WebView.
- **Device push tokens** are collected now so native push can be added later:
  `POST /api/notifications/register` `{ token, platform, app_version }`,
  `POST /api/notifications/unregister` `{ token }`, `GET /api/notifications` (history).
- **Native push delivery (Firebase Cloud Messaging)** is not built yet — it requires the Android app
  and an FCM server integration. This is planned work for the mobile phase.

---

## 10. Maps and routing (OSRM)

Routing (the blue route line + distance/ETA) is served by a **self-hosted OSRM** instance running in
Docker on the VPS (bound to `127.0.0.1:5000`, never exposed publicly). The backend proxies it at
`GET /api/osrm/route/v1/driving/{lon,lat};{lon,lat}?overview=full&geometries=geojson`, and the
frontend points `VITE_OSRM_BASE` at that proxy. The OSRM data covers the GCC states (which includes
Saudi Arabia / Riyadh). If live-traffic ETAs are ever needed, the routing call can be swapped for the
Google Routes API (paid) without changing the rest of the app.

---

## 11. Full API reference

Base URL: `https://api.smartmappia.com`. Send `Authorization: Bearer <supabase access token>` on all
endpoints except those marked public.

Health
- `GET /api/health` (public) — status + DB connectivity.

Auth
- `POST /api/auth/signup` (public) — create account (email pre-confirmed).
- `POST /api/auth/sync` — upsert profile + role after login.

Passenger / booking
- `POST /api/bookings` — create a booking (login required).
- `GET /api/bookings/:code` (public) — booking summary.
- `POST /api/bookings/:code/cancel` — owner (or admin) cancels.
- `GET /api/bookings/:code/payment-instructions` — STC Pay number + fare.
- `POST /api/bookings/:code/payment-proof/signed-url` — signed upload URL for the proof.
- `POST /api/bookings/:code/payment-proof` — record the uploaded proof.

Tracking
- `GET /api/tracking/:code` (public) — live timeline, ETAs, driver position (safe fields only).

Driver
- `GET /api/driver/available` — open ride feed (approved drivers only).
- `POST /api/driver/rides/:code/accept` — claim a ride.
- `POST /api/driver/location` — share live GPS.
- `GET /api/driver/rides` — assigned rides.
- `POST /api/driver/rides/:code/status` — advance ride status.
- `POST /api/driver/documents/signed-url` — KYC document upload URL.
- `POST /api/driver/documents` — record an uploaded KYC document.
- `GET /api/driver/documents` — the driver's document status.

Admin (role admin)
- `GET /api/admin/stats`, `GET /api/admin/reports`, `GET /api/admin/bookings`,
  `GET /api/admin/bookings/:code`.
- `POST /api/admin/bookings/:code/verify-payment`, `POST /api/admin/bookings/:code/reject-payment`,
  `POST /api/admin/bookings/:code/assign-driver`.
- `GET /api/admin/drivers`, `POST /api/admin/drivers/:id/approval`.
- `GET /api/admin/drivers/:id/documents`, `POST /api/admin/drivers/:id/documents/:docId/review`.

Notifications
- `POST /api/notifications/register`, `POST /api/notifications/unregister`, `GET /api/notifications`.

Routing
- `GET /api/osrm/route/v1/driving/...` — OSRM proxy.

---

## 12. Database (summary)

Live core tables: `profiles`, `bookings`, `payment_proofs`, `payments`, `tracking_events`,
`driver_locations`, `ledger_entries`. Verification/notifications/gateway tables: `driver_documents`,
`webhook_events`, `device_push_tokens`, `notification_events`. Plus a reporting view.

Notes:
- User accounts live in Supabase Auth (`auth.users`), mirrored 1:1 by `profiles` (role, name,
  contact, driver fields, approval + verification status).
- Booking codes look like `SM-XXXXXXXX` (8 unambiguous characters, unique), generated in the
  database.
- Row-Level Security is on for every table; the backend service_role key bypasses it for trusted
  work, while anon/app clients can only read their own rows.
- Storage buckets (both private): `payment-proofs` and `driver-docs`.

---

## 13. Deployment (how production is hosted)

- **Supabase (standalone project):** migrations applied (base schema + auth/approval fields + profile
  fields + driver verification + payment gateway schema + data-collection + notifications). Two
  private storage buckets created. RLS enabled.
- **VPS (Hostinger, Ubuntu):** Node 20 + PM2 runs the Express API (process `smartmappia-api`), behind
  Nginx with Let's Encrypt HTTPS. `api.smartmappia.com` proxies to the app on port 4000.
- **OSRM:** Docker container on the VPS, GCC-states map, exposed only through `/api/osrm`.
- **Frontend:** built to static files and served by Nginx for `smartmappia.com` + `www`, HTTPS via
  Let's Encrypt.
- **DNS:** `api`, apex (`@`), and `www` records point at the VPS; the domain uses Hostinger DNS.

Backend environment variables (server only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PORT`,
`CORS_ORIGINS`, `ADMIN_EMAILS`, `PAYMENT_MODE=stcpay_manual`, `AUTO_VERIFY_STCPAY_TEST_MODE=false`,
`SMART_MAPPIA_STCPAY_NUMBER`, `PAYMENT_PROOF_BUCKET`, and (when Tap is enabled) the four `TAP_*` keys.

Redeploy after a code change:
- Backend: pull the repo, `npm install --omit=dev`, restart the PM2 process.
- Frontend: pull the repo, `npm run build` (Nginx serves the new `dist`).

---

## 14. Building the Android app (Capacitor)

The Android app wraps the existing web build. All API calls already go to `https://api.smartmappia.com`.

Prerequisites on the build machine: Node 20+, JDK 17, Android Studio + Android SDK (Platform 34+),
and an emulator or device. An `.apk`/`.aab` can only be compiled with this toolchain.

Steps (run inside the `frontend` folder):
1. Install Capacitor packages: `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`,
   `@capacitor/geolocation` (and later `@capacitor/push-notifications`, `@capacitor/app`,
   `@capacitor/browser`).
2. Initialize: `npx cap init "Smart Mappia" com.smartmappia --web-dir dist`.
3. Build the web with the production environment (Section 5), then `npx cap add android` and
   `npx cap sync`.
4. Open in Android Studio (`npx cap open android`) to run/build. Debug APK from CLI:
   `cd android && ./gradlew assembleDebug`. Release build for distribution needs a signing keystore
   configured in `android/app/build.gradle`, then `./gradlew assembleRelease` (APK) or
   `bundleRelease` (AAB for Google Play).
5. After any web change: `npm run build` then `npx cap sync`, then rebuild.

Android permissions to add to the manifest: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`
(driver GPS), `INTERNET`, `POST_NOTIFICATIONS` (Android 13+, for push), and optionally `CAMERA` for
in-app photo capture.

Native work to implement:
- **Geolocation:** in the geolocation module, when running natively use `@capacitor/geolocation`
  (get/watch position + permission request), falling back to the browser API on web. The driver page
  pings location every ~12s.
- **Push (FCM):** create a Firebase project, add the Android app (`com.smartmappia`), place
  `google-services.json` in `android/app/`, register the FCM token on login via
  `POST /api/notifications/register`, and unregister on logout. Server-side sending is not built yet
  and must be added with the backend team.
- **Payment deep link (Tap, later):** open the Tap hosted URL with the in-app browser and return via
  a deep link (e.g. `com.smartmappia://payment-return`); rely on the webhook for confirmation.

Connecting to the backend: nothing hardcoded — the base URL is `VITE_API_BASE` and the auth token is
attached automatically from the Supabase session. If the app hits CORS errors, add the Capacitor
origin (`https://localhost`) to the backend `CORS_ORIGINS` and restart the API.

Watch-items: the app uses standard browser-history routing (works in the WebView; switch to hash
routing only if in-app navigation misbehaves); all endpoints are HTTPS (no cleartext config needed);
the WebView must allow WebSocket for live tracking; and only the anon key may ship in the app.

---

## 15. Status — done vs remaining

Done and live in production:
- Web app (site + rider/driver/admin portals), booking, live tracking.
- Manual STC Pay + admin verification.
- Driver verification (KYC): upload, admin review, auto-approve gate.
- Self-hosted OSRM routing.
- Security: rate limiting, RLS, admin locked to an allow-list, error sanitization.
- Standalone Supabase; VPS backend + frontend over HTTPS.

Remaining:
- Build and ship the Android app (this document).
- Native push delivery (FCM) on the server side.
- Tap Payments backend (create-charge + webhook) when the merchant account is ready.
- Launch hardening: rotate the Supabase service_role key, remove the test accounts
  (`***REMOVED***` / `***REMOVED***`), and confirm strong admin passwords.
