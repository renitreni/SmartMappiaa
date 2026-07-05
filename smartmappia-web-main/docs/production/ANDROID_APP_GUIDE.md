# Smart Mappia — Pick & Drop: Android App Guide

Everything an Android developer needs to build and ship the Smart Mappia mobile app, and to
understand the live system it talks to. The Android app is **not a separate codebase** — it wraps
the existing React web app with **Capacitor** and points at the live backend.

Last updated: 1 July 2026. Companion docs: [PICK_AND_DROP.md](PICK_AND_DROP.md) (feature source of
truth), [DEPLOYMENT_LOG.md](DEPLOYMENT_LOG.md) (how prod was deployed),
[../../backend/DOCUMENTATION.md](../../backend/DOCUMENTATION.md) (backend deep dive).

---

## 1. TL;DR

- The product is a **web app** (React + Vite) already **live in production**:
  - Website: **https://smartmappia.com**
  - API: **https://api.smartmappia.com** (Node/Express)
  - Database/Auth/Storage/Realtime: **Supabase** (standalone project)
  - Routing: **self-hosted OSRM** proxied at `https://api.smartmappia.com/api/osrm/...`
- The Android app = **Capacitor wrapper** around that web app. All API calls already go to
  `https://api.smartmappia.com`, so the phone app talks to the same backend as the website.
- Your job: add Capacitor to `frontend/`, wire **native geolocation** (and later push + payment
  deep links), and build the signed `.apk` / `.aab`.

---

## 2. System architecture

```
 Android app (Capacitor WebView)  ─┐
 Web browser (smartmappia.com)    ─┼──HTTPS──►  api.smartmappia.com (Express)
                                   │                 ├─ Supabase (Postgres + Auth + Storage + Realtime)
                                   │                 └─ OSRM (Docker, localhost:5000) via /api/osrm
 Supabase Realtime (WebSocket) ◄───┘  (live driver tracking broadcast)
```

- **Auth**: Supabase Auth (email + password). The client holds the session and sends
  `Authorization: Bearer <access_token>` on every API call.
- **Live tracking**: Supabase Realtime **Broadcast** (driver location pushed to a channel; the
  passenger's map subscribes). 8s polling fallback. No custom socket server.
- **Routing/map**: Leaflet + CARTO tiles for the map picture; OSRM for the route line/ETA.

---

## 3. What's live vs pending (so you know what the app must handle)

| Area | Status | App impact |
|---|---|---|
| Booking (login-gated) | LIVE | needs login before `/book` |
| Manual STC Pay + admin verification | LIVE | passenger uploads proof image (camera/gallery) |
| Online payment gateway (Tap) | **OFF** (flag) / backend TODO | button shows "coming soon"; later: browser redirect + deep link |
| Live tracking | LIVE | map + driver marker; needs realtime/websocket allowed |
| Driver KYC (doc upload + admin review) | LIVE | driver uploads docs (camera/gallery) before approval |
| Notifications (web in-app) | LIVE | in-app chime/toast works in the WebView |
| Native push (FCM) | **pending** | needs the APK first — you build this (see §7) |
| Self-hosted OSRM routing | LIVE | nothing app-specific |

---

## 4. Repo & where things are

- Repo: `https://github.com/Rizzkkk/SmartMappiaa`, branch **`full`**.
- App path: `smartmappia-web-main/frontend` (React) and `.../backend` (Express).
- Key frontend files you'll touch:
  - `frontend/src/portal/lib/geo.js` — geolocation (`useGeolocation`) → swap to native here.
  - `frontend/src/portal/lib/api.js` — API client (`VITE_API_BASE`), auto Bearer token.
  - `frontend/src/portal/lib/supabaseClient.js` — Supabase (auth, realtime, storage upload).
  - `frontend/index.html`, `frontend/vite.config.js`, `frontend/package.json`.

---

## 5. Build the Android app (Capacitor)

### Prerequisites (on the build machine)
- **Node 20+**, **JDK 17**, **Android Studio** + **Android SDK** (Platform 34+), an emulator or a
  device. (No Android toolchain = no APK. Alternatively use a CI runner with the Android SDK.)

### Decision: bundle the web assets (recommended)
Capacitor packages the built `dist/` into the APK (`webDir: dist`) and the app calls
`https://api.smartmappia.com`. UI changes require rebuilding the APK (or add OTA later). This is the
most reliable option for native features.

### Steps
```bash
cd frontend
# 1. Capacitor deps
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/geolocation
#    (+ later: @capacitor/push-notifications @capacitor/app @capacitor/browser)

# 2. init (appId + name already decided)
npx cap init "Smart Mappia" com.smartmappia --web-dir dist

# 3. build the web with production env (see §8), then add + sync android
npm run build
npx cap add android
npx cap sync

# 4. open in Android Studio to run/build
npx cap open android
```
- Debug APK from CLI: `cd android && ./gradlew assembleDebug` → `android/app/build/outputs/apk/debug/`.
- **Release** (for distribution): create a keystore, configure signing in `android/app/build.gradle`,
  then `./gradlew assembleRelease` (APK) or `bundleRelease` (AAB for Play Store).
- After any web change: `npm run build && npx cap sync` before rebuilding.

### AndroidManifest permissions (add)
```
ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION   (driver GPS)
INTERNET                                        (default)
POST_NOTIFICATIONS                              (Android 13+, for push later)
CAMERA (optional, if you want in-app capture for proof/KYC photos)
```

---

## 6. How the app connects to the backend

- **Base URL**: set at build time via `VITE_API_BASE=https://api.smartmappia.com`. The API client
  (`api.js`) prepends this to every request. Nothing hardcoded — change the env, rebuild.
- **Auth token**: `api.js` calls `supabase.auth.getSession()` and attaches
  `Authorization: Bearer <access_token>` automatically. So once the user logs in (Supabase), every
  request is authenticated. Session persists (localStorage in the WebView).
- **CORS**: the backend allows `https://smartmappia.com` + `https://www.smartmappia.com`
  (`CORS_ORIGINS`). A Capacitor WebView origin is `https://localhost` (or `capacitor://`), which is
  **not** a browser CORS origin the same way — because the bundled app is same-origin to itself and
  hits the API cross-origin. If you see CORS errors from the app, add the Capacitor origin
  (`https://localhost`) to `CORS_ORIGINS` on the backend (`backend/.env` → `pm2 restart`).
- **Supabase**: the app uses the **anon** key (`VITE_SUPABASE_ANON_KEY`) for auth + realtime +
  storage uploads. Never ship the service_role key.

---

## 7. Native integrations you implement

### 7a. Geolocation (needed for the driver)
Today `geo.js` uses `navigator.geolocation`. For native reliability, in `geo.js` detect Capacitor
and use `@capacitor/geolocation`:
```js
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
// if (Capacitor.isNativePlatform()) use Geolocation.getCurrentPosition()/watchPosition()
// else fall back to navigator.geolocation
```
Keep the existing `useGeolocation` signature so nothing else changes. Request permission on first
use. The driver page pings `POST /api/driver/location` every ~12s.

### 7b. Push notifications (FCM) — pending, this is your build
Backend already collects device tokens:
- `POST /api/notifications/register` `{ token, platform: "android", app_version }`
- `POST /api/notifications/unregister` `{ token }`
- `GET  /api/notifications` (history)

To finish native push:
1. Create a **Firebase** project, add the Android app (`com.smartmappia`), download
   `google-services.json` into `android/app/`.
2. Add `@capacitor/push-notifications`; on login, get the FCM token and call
   `api.registerPushToken({ token, platform: 'android' })`; on logout call `unregisterPushToken`.
3. **Server-side send is NOT built yet** — a backend worker must read `device_push_tokens` and send
   via FCM on booking events (driver assigned/arrived, etc.), logging to `notification_events`.
   Coordinate with the backend dev for the FCM server key + send endpoint.

### 7c. Payment return deep link (for Tap, later — see §9)
When Tap is enabled, the app opens the hosted payment URL with `@capacitor/browser` and returns via
a deep link (e.g. `com.smartmappia://payment-return`). Payment truth comes from the **webhook**, not
the redirect — so the app just needs to reopen the tracking/booking screen on return.

---

## 8. Environment variables (build the web with these)

`frontend/.env` (compiled into the bundle at build time — rebuild after any change):
```
VITE_API_BASE=https://api.smartmappia.com
VITE_SUPABASE_URL=<supabase project url>
VITE_SUPABASE_ANON_KEY=<supabase ANON key>      # NEVER the service_role key
VITE_OSRM_BASE=https://api.smartmappia.com/api/osrm/route/v1/driving
VITE_TAP_ENABLED=false                            # true only when Tap backend is live
```
Golden rule: `VITE_*` is public (ships in the app). The service_role key lives only in the backend.

---

## 9. Payments (read this carefully)

### 9a. STC Pay — MANUAL (this is the live, working flow)
No card gateway. The passenger pays by STC Pay and uploads a screenshot; an admin verifies it.

Flow the app must support:
1. `GET /api/bookings/:code/payment-instructions` → returns the Smart Mappia STC Pay **number**
   (currently `0553476619`) + name + the fare (SAR, base 100 + 3.75% service fee = 103.75).
2. Passenger transfers via their STC Pay app to that number.
3. Passenger uploads the proof screenshot:
   - `POST /api/bookings/:code/payment-proof/signed-url` `{ file_name, mime_type }` → returns a
     signed upload URL/token + bucket + path.
   - Upload the file straight to Supabase Storage using that signed URL (see
     `supabaseClient.uploadProofFile(bucket, path, token, file)`).
   - `POST /api/bookings/:code/payment-proof` `{ path, file_name, mime_type, size_bytes }` → records
     it; booking becomes `payment_under_review`.
4. An **admin** verifies in the admin portal → booking becomes `confirmed` and is published to
   drivers. (`AUTO_VERIFY_STCPAY_TEST_MODE=false` in prod, so a human must verify.)

App note: allow the passenger to pick from **gallery or camera** for the proof image
(`image/jpeg|png|webp` or `application/pdf`, max 10 MB).

### 9b. Tap Payments — ONLINE gateway (deferred; schema ready, backend TODO)
Not live yet. `VITE_TAP_ENABLED=false`, so `TapPayButton` shows "Pay online — coming soon".
When it's turned on:
- Backend will expose `POST /api/payments/:code/tap-charge` → returns a hosted `transaction.url`.
- The app opens that URL (`@capacitor/browser`), user pays (STC Pay / mada / card via Tap), returns
  via deep link.
- A **Tap webhook** (`gateway_webhook` verification mode; `webhook_events` table) is the source of
  truth that confirms the booking — the app must not assume success from the redirect alone.
- Backend env (server only): `TAP_SECRET_KEY`, `TAP_PUBLIC_KEY`, `TAP_WEBHOOK_SECRET`,
  `TAP_MERCHANT_ID`. DB schema for this already exists (migration 0006: `tap` provider,
  `gateway_*` columns, `webhook_events`).

So: build the app so the "Pay online" button is easy to enable later, but manual STC Pay is the
only working path today.

---

## 10. Driver verification (KYC) — live

A new driver signs up → is **unapproved** → sees the verification screen (not the ride feed) →
uploads documents → an admin verifies each → once all required docs are verified the driver is
**auto-approved** and can go online.

App-relevant endpoints (driver):
- `POST /api/driver/documents/signed-url` `{ doc_type, file_name, mime_type }` → signed upload URL
- upload file to the returned signed URL (private `driver-docs` bucket)
- `POST /api/driver/documents` `{ path, doc_type, file_name, mime_type, size_bytes, expiry_date? }`
- `GET  /api/driver/documents` → status of each doc + what's missing

Required doc types: `national_id, license, vehicle_registration, insurance, profile_photo,
vehicle_photo` (`tga_permit` optional). App note: camera/gallery picker again.

---

## 11. Full API reference (base `https://api.smartmappia.com`)

Auth: send `Authorization: Bearer <supabase access token>` except where noted "public".

**Health**: `GET /api/health` (public)

**Auth**: `POST /api/auth/signup` (public), `POST /api/auth/sync`

**Passenger / booking**:
- `POST /api/bookings` (login) · `GET /api/bookings/:code` (public) · `POST /api/bookings/:code/cancel`
- `GET /api/bookings/:code/payment-instructions` · `POST /api/bookings/:code/payment-proof/signed-url`
  · `POST /api/bookings/:code/payment-proof`

**Tracking**: `GET /api/tracking/:code` (public — safe fields only)

**Driver**: `GET /api/driver/available` · `POST /api/driver/rides/:code/accept` ·
`POST /api/driver/location` · `GET /api/driver/rides` · `POST /api/driver/rides/:code/status` ·
`POST /api/driver/documents/signed-url` · `POST /api/driver/documents` · `GET /api/driver/documents`

**Admin** (role admin): `GET /api/admin/stats` · `/reports` · `/bookings` · `/bookings/:code` ·
`POST /api/admin/bookings/:code/verify-payment` · `/reject-payment` · `/assign-driver` ·
`GET /api/admin/drivers` · `POST /api/admin/drivers/:id/approval` ·
`GET /api/admin/drivers/:id/documents` · `POST /api/admin/drivers/:id/documents/:docId/review`

**Notifications**: `POST /api/notifications/register` · `/unregister` · `GET /api/notifications`

**Routing (OSRM proxy)**: `GET /api/osrm/route/v1/driving/{lon,lat};{lon,lat}?overview=full&geometries=geojson`

---

## 12. Roles & access

- **Passenger** — default on signup; must be logged in to book.
- **Driver** — chosen at signup; starts **unapproved**, must pass KYC (see §10).
- **Admin** — never self-assignable. Only emails in the backend `ADMIN_EMAILS` list become admin.
  The signup UI only offers passenger/driver.

---

## 13. Gotchas / watch-items

- **Routing**: the app uses React Router `BrowserRouter`; works in the WebView. If in-app deep
  navigation misbehaves, switch to `HashRouter`.
- **HTTPS everywhere** — no Android cleartext-traffic config needed.
- **CORS from the app**: if requests fail with CORS, add the Capacitor origin to `CORS_ORIGINS`
  (§6).
- **Realtime**: the WebView must allow WebSocket to Supabase (default OK).
- **Rebuild discipline**: any `VITE_*` change or web code change ⇒ `npm run build && npx cap sync`
  ⇒ rebuild APK.
- **Secrets**: only the anon key ships in the app. Never bundle service_role or Tap secret keys.
- **Test accounts** (`user123` / `driver123`) exist for QA and must be removed before public launch.
