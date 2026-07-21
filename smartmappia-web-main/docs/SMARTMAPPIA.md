# Smart Mappia — Platform Master Documentation

The single, self-contained reference for the whole Smart Mappia platform: both services
(**Pick & Drop** rides and **Food Delivery**), the architecture, roles & auth, dispatch,
payments, storage, the database, environment, local setup, deployment, security, the admin
runbook, and a changelog. For the Food Delivery deep-dive see the companion
[FOOD_DELIVERY.md](food-delivery/FOOD_DELIVERY.md); historical/superseded docs live under
[archive/](archive/).

- **Last updated:** 2026-07-11
- **Website:** https://smartmappia.com · **API:** https://api.smartmappia.com
- **Repo:** https://github.com/Rizzkkk/SmartMappiaa (branch `full`)

---

## Table of contents

1. [Overview](#1-overview)
2. [Tech stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Repository layout](#4-repository-layout)
5. [Roles, accounts & authentication](#5-roles-accounts--authentication)
6. [Pick & Drop service](#6-pick--drop-service)
7. [Food Delivery service](#7-food-delivery-service)
8. [Grab-style dispatch (both services)](#8-grab-style-dispatch-both-services)
9. [Payments](#9-payments)
10. [Storage buckets](#10-storage-buckets)
11. [Notifications](#11-notifications)
12. [Database & ERD](#12-database--erd)
13. [Environment variables](#13-environment-variables)
14. [Local setup & running](#14-local-setup--running)
15. [Demo playbook](#15-demo-playbook)
16. [Deployment / hosting / production](#16-deployment--hosting--production)
17. [Security](#17-security)
18. [Admin operations runbook](#18-admin-operations-runbook)
19. [Testing / QA](#19-testing--qa)
20. [Changelog (recent work)](#20-changelog-recent-work)
21. [Roadmap / wishlist](#21-roadmap--wishlist)

---

## 1. Overview

Smart Mappia is a Riyadh (Saudi Arabia) platform running **two services** on one codebase,
one Supabase project, and one auth system:

- **Pick & Drop** — an airport-focused, Grab-style ride service. A passenger books a ride,
  pays by STC Pay (manual proof + admin verification), a nearby approved driver accepts, and
  the passenger tracks the driver live on a map.
- **Food Delivery** — restaurant ordering and delivery. Admin-onboarded restaurants, a customer
  cart/checkout with server-enforced money rules, Grab-style rider dispatch, live tracking, and
  STC Pay / cash payment. See [FOOD_DELIVERY.md](food-delivery/FOOD_DELIVERY.md).

The product is a **web app** (React) talking to a **Node/Express API** backed by **Supabase**
(Postgres + Auth + Storage + Realtime), with **self-hosted OSRM** for road routing. The **Android
app** is the same web app wrapped with **Capacitor** — there is no separate mobile codebase.
Roles: **passenger/customer**, **driver (rider)**, **merchant (restaurant owner)**, **admin**.

An **ecommerce** service is planned next and is expected to reuse the same order-status/tracking
components built for Food Delivery.

---

## 2. Tech stack

- **Frontend:** React 19 + Vite + Tailwind. Maps via Leaflet with CARTO/OpenStreetMap tiles.
  Supabase JS client for auth, realtime, and direct-to-storage file uploads. PDF receipts via
  `jspdf` + `html2canvas`.
- **Backend:** Node.js 20 + Express (plain JavaScript, CommonJS). Runs under PM2 behind Nginx
  with Let's Encrypt HTTPS on a Hostinger VPS.
- **Database / Auth / Storage / Realtime:** Supabase (standalone project, Postgres 15).
- **Routing engine:** OSRM (Open Source Routing Machine) in Docker on the VPS, bound to
  localhost and exposed only through the backend at `/api/osrm`.
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

A map screen is three independent layers: **base tiles** (CARTO via Leaflet), **routing**
(self-hosted OSRM: the road line + distance/ETA), and **live tracking** (the moving driver dot
via Supabase Realtime Broadcast — not OSRM).

**Live tracking flow:** the driver app sends GPS every ~12 s to `POST /api/driver/location`; the
backend stores it (`driver_locations`) and broadcasts the new position to the passenger/customer
over a Supabase Realtime channel; the client also polls every ~8 s as a fallback. No custom
WebSocket/Redis server is needed.

**In-process background workers** (`server.js` → `lib/dispatch.js`, started once on boot):
- the **offer sweeper** expires overdue dispatch offers and cascades each job to the next-nearest
  driver (every `DISPATCH_SWEEP_MS`, default 5 s);
- the **disconnect watchdog** reclaims deliveries/rides whose assigned driver's GPS has gone
  stale before pickup (every ≥20 s).

**Serverless caveat:** on a serverless host there is no in-process sweeper/watchdog; jobs still
reach drivers through the open-pool fallback, but the timed re-dispatch only runs on the VPS.

---

## 4. Repository layout

```
backend/
  app.js                 Express app: Helmet, CORS, rate limiters, routes, error handler
  server.js              boot: start HTTP server + dispatch sweeper/watchdog
  api/index.js           serverless entry (Vercel-compatible)
  routes/                admin.js, auth.js, bookings.js, driver.js, food.js, health.js,
                         merchant.js, locations.js, notifications.js, osrm.js, tracking.js
  controllers/           auth, bookings, driver, driverDispatch, driverDocs, tracking,
                         ratings, payments, notifications, admin, merchant, food/*
  lib/                   config, supabase, storage, uploadValidation, dispatch, fare,
                         foodMoney, ledger, geo, tracking, realtime, notifications,
                         audit, validate, foodEvents, profileSchema
  migrations/            0001..0016 SQL (run in order in Supabase SQL Editor)
  scripts/               seed-admin.js, seed-admins.js, seed-user.js, seed-driver.js,
                         check-migrations.js, demo/*
frontend/
  src/portal/            auth/, user/ (passenger), driver/, merchant/, admin/, food/,
                         components/, lib/ (api, AuthProvider, supabaseClient, constants,
                         notifications, uploadFiles, ...)
  src/sections/          marketing site sections
docs/
  SMARTMAPPIA.md         (this file — master)
  food-delivery/FOOD_DELIVERY.md   (food deep-dive)
  archive/               superseded/historical docs
```

---

## 5. Roles, accounts & authentication

Authentication is **Supabase Auth** (email + password). After login the client holds a session
and sends `Authorization: Bearer <access_token>` on every API call; the backend verifies the
token and reads the role from the `profiles` table (mirrored 1:1 with `auth.users`).

| Role | How it's obtained | Capabilities |
|---|---|---|
| **passenger / customer** | Default on signup | Book rides, order food, pay, track, rate |
| **driver (rider)** | Chosen at signup; starts **unapproved** | After KYC + admin approval: ride feed, delivery offers, accept, GPS, status |
| **merchant** | **Admin-granted only** (owner account linked at contract signing) | Merchant portal; receives owner notifications |
| **admin** | **Env allow-list only** (`ADMIN_EMAILS`) or an existing admin profile | Full oversight of both services |

Rules enforced in [`controllers/authController.js`](../backend/controllers/authController.js):
- `SELF_ROLES = ['passenger','driver']` — only these can be self-selected at signup. **merchant**
  and **admin** can never be self-assigned via the API.
- A user becomes **admin** only if their email is in `ADMIN_EMAILS` (case-insensitive,
  comma-separated) or they already have an admin profile (`syncProfile` preserves it).
- **merchant** role is granted when an admin links an owner account to a restaurant
  (`POST /api/admin/food/merchants/:id/owner`).

**Creating admins:** see the [Admin operations runbook](#18-admin-operations-runbook). The named
production admins are seeded with `npm run seed:admins` (Ruth, Nawaf) and are also listed in
`ADMIN_EMAILS`.

---

## 6. Pick & Drop service

### 6.1 Booking lifecycle

`booking_status`: `pending_payment` → `payment_under_review` → `confirmed` → `driver_assigned` →
`driver_on_the_way` → `arrived` → `in_progress` → `completed` (or `cancelled`).
`driver_ride_status` (rider's view): `accepted` → `on_the_way` → `arrived` → `started` →
`completed` (or `cancelled`).

1. Passenger books (login-gated): trip type (house↔airport), pickup/dropoff, schedule, passenger
   details. A fare snapshot is computed server-side (`lib/fare.js`).
2. Passenger pays via **manual STC Pay** and uploads a proof screenshot (see [Payments](#9-payments)).
3. An **admin verifies** the proof → booking becomes `confirmed` and is dispatched to drivers.
4. Dispatch offers the ride to the nearest approved online driver (see [Dispatch](#8-grab-style-dispatch-both-services)).
5. The accepted driver advances status; the passenger tracks live on the map with ETA, a status
   timeline, an in-app chime/toast on "on the way"/"arrived", and Call/WhatsApp.
6. On `completed` the ledger/payout entry is written (`lib/ledger.js`); the passenger can rate the
   driver (1–5 stars).

### 6.2 Driver verification (KYC) — live

A new driver signs up **unapproved** and sees the verification screen instead of the ride feed.
Required documents: `national_id` (ID/Iqama), `license`, `vehicle_registration` (Istimara),
`insurance`, `profile_photo`, `vehicle_photo` (+ optional `tga_permit`). Files upload to the
private `driver-docs` bucket via signed URLs; an admin reviews each (Verify/Reject with reason);
once all required docs are `verified` the driver is auto-approved and can go online. An expiry
date can be captured per document for renewal tracking.

---

## 7. Food Delivery service

Full detail in [FOOD_DELIVERY.md](food-delivery/FOOD_DELIVERY.md). Summary:

- **Admin-driven onboarding.** Restaurants do not self-register. An admin creates the restaurant,
  imports its menu/prices/photos, optionally links an **owner account** (grants the `merchant`
  role) at contract signing, and flips it **Listed** (`is_active = true`). New restaurants start
  **Unlisted**.
- **Order flow:** browse → menu → cart → checkout (server recomputes all money) → pay (STC Pay
  proof or cash) → merchant/admin accepts → preparing → ready → Grab-style rider dispatch → picked
  up (mandatory photo) → out for delivery → delivered (mandatory photo; cash collected here) →
  rate rider.
- **Hard business rules (server-enforced, `lib/foodMoney.js`):** cart food subtotal **≥ 30 SAR**;
  flat **10 SAR** delivery within **15 km** (haversine); per-item platform margin **5 SAR**
  (meals/packages) / **3 SAR** (drinks/desserts/add-ons); merchant **300 SAR** credit limit with
  an **80% (240 SAR)** alert and **auto-suspend at 300**. Money is always recomputed from DB rows —
  client totals are never trusted.
- **Pricing model:** the **current live** model charges the platform margin to the restaurant's
  300 SAR credit on accept. An **approved-but-pending** model (migration 0017) inverts this to a
  **customer-pays-the-markup + payout ledger** model — see FOOD_DELIVERY.md §pricing.
- **Images:** restaurant logos and menu photos are **file uploads** to the public `merchant-images`
  bucket (not URLs).

---

## 8. Grab-style dispatch (both services)

Shared by Pick & Drop rides and Food deliveries. Source: [`lib/dispatch.js`](../backend/lib/dispatch.js),
[`controllers/driverDispatchController.js`](../backend/controllers/driverDispatchController.js),
migration `0013_dispatch_and_merchant_vetting.sql` (`dispatch_offers` table).

### 8.1 The offer cascade

1. A job becomes dispatchable (booking payment verified, or food order accepted + paid/cash).
2. The **nearest online approved driver** gets an **exclusive 30-second offer** (`dispatch_offers`
   row + realtime push). "Online" = a GPS ping fresher than `DISPATCH_DRIVER_FRESH_MINUTES` (3).
   Distance = haversine over each driver's freshest `driver_locations` fix — no Redis/quadtree/
   geohash/R-tree (fine at current scale).
3. **Decline** → instantly cascades to the next-nearest driver (`offerNext`). **Timeout** → the
   sweeper expires the offer and cascades.
4. When every candidate has passed (or none were online), the job drops into the **open pool** —
   the classic first-come feed — so it is never stuck.

**Double-claim safety (three layers):** one pending offer per job (partial unique index),
compare-and-swap on the offer row when accepting, and a final compare-and-swap on the job itself
(`deliveries.driver_id` / `bookings.assigned_driver_id` must still be null to win). Two drivers can
never both win.

### 8.2 Auto re-dispatch on cancel / disconnect (NEW)

Once a driver **accepts**, the job can still be returned to the cascade — for **both** services —
**before pickup / trip start**. After pickup (food) or trip start (rides) it becomes a manual/admin
case; the food is with the rider / the passenger is in the car.

- **Food** — `releaseFoodDelivery()` clears `deliveries.driver_id`, sets status `searching`, and
  re-runs `offerNext`. Driver endpoint `POST /api/driver/deliveries/:code/cancel` (pre-pickup);
  watchdog `sweepAbandonedDeliveries()` reclaims a delivery whose rider's GPS is stale past
  `DISPATCH_ABANDON_MINUTES` (5).
- **Rides** — `releaseRide()` returns the booking to `confirmed`/unassigned and re-runs `offerNext`.
  Driver endpoint `POST /api/driver/rides/:code/cancel` (pre-start: `accepted`/`on_the_way`/
  `arrived`); watchdog `sweepAbandonedRides()`. The ride watchdog is deliberately **narrower** —
  it only reclaims `on_the_way`/`arrived` rides, never a merely-`accepted` one, because a driver
  may accept a **scheduled** ride hours ahead and not be pinging GPS yet.

The canceller is automatically excluded from the re-offer (they already appear in
`dispatch_offers`). Notifications fire to the customer (`food_finding_new_rider` /
`ride_finding_new_driver`) and the old driver; the customer's tracking page reverts to a
"finding a new rider/driver" state.

### 8.3 Backlog — ETA-based ranking (once driver volume grows)

Straight-line haversine (8.1) is fine while there are only a handful of online drivers per area —
but it will start picking the **wrong** nearest candidate once volume grows enough that "closest
as the crow flies" regularly diverges from "closest by road" (river/highway with no direct
crossing, one-way street grids, heavy localized traffic). That's the point to revisit, not before.

Sketch for when it's warranted: re-rank only the top ~6 haversine-nearest candidates (not every
online driver — bound the cost) by real driving ETA from the self-hosted OSRM instance's
`/table/v1/driving/...` endpoint (one request per dispatch round returns the whole
duration matrix, not one call per candidate). Must degrade to the current haversine order with
zero behavior change if OSRM is slow/unreachable — same best-effort philosophy as the existing
`frontend/src/portal/lib/osrm.js` route-fetching. Needs a deploy-time check that `/table` is
enabled on the VPS's OSRM build before turning it on.

---

## 9. Payments

### 9.1 STC Pay — MANUAL (the live method)

No card gateway is in use. The customer pays via their own STC Pay app and uploads a proof
screenshot; an admin verifies it.

- Rides: `GET /api/bookings/:code/payment-instructions` (STC Pay number + fare) →
  `POST /api/bookings/:code/payment-proof/signed-url` → direct upload to private `payment-proofs`
  bucket → `POST /api/bookings/:code/payment-proof` → booking `payment_under_review` → admin
  verify → `confirmed`.
- Food: `POST /api/food/orders/:code/pay/signed-url` → upload → `POST /api/food/orders/:code/pay`
  → admin verify.
- Accepted proof files: JPEG/PNG/WebP/PDF up to 10 MB. In production
  `AUTO_VERIFY_STCPAY_TEST_MODE=false` — a human must verify (no auto-approval).

### 9.2 Cash on delivery (food)

Chosen at checkout; the rider collects cash at the door. Marking `delivered` records the payment
(`markOrderPaid`, idempotent).

### 9.3 Tap Payments — ONLINE gateway (deferred; schema ready, backend not built)

Not live. Schema exists (`tap` provider, `gateway_*` columns, `gateway_webhook` mode,
`webhook_events` audit table); the frontend has a flag-gated "Pay online — coming soon" button.
When enabled: `POST /api/payments/:code/tap-charge` returns a hosted URL; a **signature-verified
webhook** (logged to `webhook_events`) is the source of truth. Needs `TAP_SECRET_KEY`,
`TAP_PUBLIC_KEY`, `TAP_WEBHOOK_SECRET`, `TAP_MERCHANT_ID`, then `VITE_TAP_ENABLED=true` + rebuild.

### 9.4 Ledger / payout math

`lib/ledger.js` (rides) and the merchant credit ledger (food). Commission rate
`PLATFORM_COMMISSION_RATE` (default 0.20). Only tokens/transaction ids are ever stored — never card
numbers/CVV/expiry.

---

## 10. Storage buckets

All uploads use the same **signed-upload** pattern ([`lib/storage.js`](../backend/lib/storage.js)):
the backend issues a short-lived signed upload URL/token, the browser uploads **directly** to
Supabase Storage, and the file never passes through our server.

| Bucket | Visibility | Holds | Served via |
|---|---|---|---|
| `payment-proofs` | **Private** | STC Pay proof images (rides + food) | short-lived signed download URLs (admin review) |
| `driver-docs` | **Private** | Driver KYC documents; rider pickup/delivery proof photos | short-lived signed download URLs (admin review) |
| `merchant-images` | **Public** | Restaurant logos + menu photos | plain public URL in `<img src>` |

`merchant-images` is public because those images are customer-facing; uploads/deletes still go
through the service-role key (RLS-bypassing), and the browser only ever gets a single-object signed
token. Image validation: logos JPG/PNG/WebP, menu photos JPG/PNG (`lib/uploadValidation.js`).

---

## 11. Notifications

- **In-app bell + history:** every lifecycle event is logged to `notification_events` and pushed
  live to the user's personal Realtime channel; the frontend renders it via the type→label map in
  [`portal/lib/notifications.js`](../frontend/src/portal/lib/notifications.js) (title, icon, tone,
  deep link). Covers rides (`ride_*`), food (`food_*`), and the re-dispatch events
  (`*_finding_new_*`, `*_cancelled_by_you`, `*_reclaimed`).
- **In-app chime + toast** on driver on-the-way/arrived (works inside the Android WebView).
- **Device push tokens** are collected now (`/api/notifications/register|unregister`) so native
  push drops in later.
- **Native push (FCM)** is not built yet — planned with the Android app.

---

## 12. Database & ERD

Postgres 15 on Supabase. **Row-Level Security is ON for every table** with owner/driver/admin
policies + an `is_admin()` helper; the backend uses the **service_role** key (bypasses RLS) for
trusted server-side work, while anon/app clients can only read their own rows. Public trip/order
tracking goes through security-definer functions returning only safe fields by code.

**Core (Pick & Drop):** `profiles`, `bookings`, `payment_proofs`, `payments`, `tracking_events`,
`driver_locations`, `ledger_entries`. **Verification / notifications / gateway:**
`driver_documents`, `webhook_events`, `device_push_tokens`, `notification_events`.
**Dispatch:** `dispatch_offers`.
**Food:** `merchants`, `menu_categories`, `menu_items`, `carts`, `cart_items`, `orders`,
`order_items`, `order_payments`, `deliveries`, `merchant_credit_ledger`, `ratings`.

Notes:
- `profiles` mirrors `auth.users` 1:1 (role, name, contact, driver fields, approval + verification
  status). `role` enum: `passenger`, `driver`, `admin`, `merchant`.
- Booking codes look like `SM-XXXXXXXX` (8 unambiguous chars, unique, DB-generated). Food order
  codes are similar.
- `deliveries.status` is free-text (`searching`/`assigned`/`open`/`picked_up`/`delivered`), so
  re-dispatch needs no migration.
- Full per-entity attribute tables, the Mermaid ERD, and enum definitions are preserved in
  [archive/production/db/DATABASE_ERD.md](archive/production/db/DATABASE_ERD.md) and, for food,
  [FOOD_DELIVERY.md](food-delivery/FOOD_DELIVERY.md).

**Migrations (run in order in the Supabase SQL Editor; verify with `npm run check:migrations`):**
`0001` base schema · `0002` auth/driver approval · `0003` profile fields · `0004` PILOT
auto-approve (**skip in production**) · `0005` driver verification · `0006` payment gateway ·
`0007` data collection · `0008` notifications · `0009` food core · `0010` food orders ·
`0011` food credit · `0012` food extras · `0013` dispatch + merchant vetting · `0014` driver
ratings · `0015` merchant homepage presentation · `0016` food audit hardening. `0017`
(customer-markup + payout ledger) is **pending**.

---

## 13. Environment variables

**Backend** (`backend/.env`, server-only — never shipped to the browser). Parsed in one place:
[`lib/config.js`](../backend/lib/config.js).

| Var | Default | Purpose |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | — | Supabase project + service-role key (RLS-bypassing) |
| `PORT` | 4000 | API port |
| `CORS_ORIGINS` | (allow-all if unset) | Comma-separated allowed origins; **set to prod origin at launch** |
| `ADMIN_EMAILS` | — | Comma-separated admin allow-list (incl. `ruth@`, `nawaf@smartmappia.com`) |
| `PAYMENT_MODE` | `stcpay_manual` | Payment path |
| `AUTO_VERIFY_STCPAY_TEST_MODE` | `false` | **TESTING ONLY** — auto-verify proofs. Keep `false` in prod |
| `SMART_MAPPIA_STCPAY_NUMBER` / `_NAME` | — | STC Pay recipient shown to the payer |
| `PAYMENT_PROOF_BUCKET` / `_UPLOAD_TTL` / `_DOWNLOAD_TTL` / `_MAX_BYTES` | `payment-proofs` / 900 / 3600 / 10 MB | Proof storage |
| `DRIVER_DOCS_BUCKET` (+ TTL/max) | `driver-docs` | KYC storage |
| `MERCHANT_IMAGES_BUCKET` / `_UPLOAD_TTL` / `_MAX_BYTES` | `merchant-images` / 900 / 5 MB | Public logo/menu images |
| `DISPATCH_OFFER_SECONDS` | 30 | Exclusive offer window |
| `DISPATCH_DRIVER_FRESH_MINUTES` | 3 | "Online" GPS freshness |
| `DISPATCH_SWEEP_MS` | 5000 | Offer sweeper interval |
| `DISPATCH_ABANDON_MINUTES` | 5 | Rider-disconnect reclaim threshold (pre-pickup) |
| `FOOD_MIN_ORDER` / `FOOD_DELIVERY_FEE` / `FOOD_RADIUS_KM` | 30 / 10 / 15 | Food rules |
| `FOOD_MARGIN_MEAL` / `FOOD_MARGIN_DRINK` | 5 / 3 | Per-item platform margin |
| `MERCHANT_CREDIT_LIMIT` / `CREDIT_ALERT_PCT` | 300 / 0.8 | Merchant credit gate |
| `PLATFORM_COMMISSION_RATE` / `MANUAL_PAYMENT_FEE` | 0.20 / 0 | Ledger math |
| `TAP_SECRET_KEY` / `TAP_PUBLIC_KEY` / `TAP_WEBHOOK_SECRET` / `TAP_MERCHANT_ID` | — | Tap (unset = "not configured") |
| `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` | `admin123@…` / `admin123` | Default admin seed (`seed:admin`) |

**Frontend** (`frontend/.env`, `VITE_*` compiled into the build — **rebuild after any change**;
only the Supabase **anon** key belongs here, never service_role):

```
VITE_API_BASE=https://api.smartmappia.com
VITE_SUPABASE_URL=<supabase project url>
VITE_SUPABASE_ANON_KEY=<ANON/public key>
VITE_OSRM_BASE=https://api.smartmappia.com/api/osrm/route/v1/driving
VITE_TAP_ENABLED=false
```

---

## 14. Local setup & running

1. **Database** — in the Supabase SQL Editor run the migrations in order (`0001, 0002, 0003, 0005,
   0006, 0007, 0008` for the ride core; then `0009`–`0016` for food). **Skip `0004`** (pilot-only
   auto-approve). Verify with `cd backend && npm run check:migrations`.
2. **Storage** — create two **private** buckets `payment-proofs`, `driver-docs`, and one **public**
   bucket `merchant-images` (SQL fallback if the dashboard errors:
   `insert into storage.buckets (id,name,public) values ('merchant-images','merchant-images',true) on conflict do nothing;`).
3. **Backend env** — `cp backend/.env.example backend/.env`, fill `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`, `SMART_MAPPIA_STCPAY_NUMBER`. Keep
   `AUTO_VERIFY_STCPAY_TEST_MODE=true` for local testing (**`false` in production**).
4. **Frontend env** — `cp frontend/.env.example frontend/.env`, set `VITE_SUPABASE_URL` +
   `VITE_SUPABASE_ANON_KEY` (anon key only) + `VITE_API_BASE`.
5. **Run** — `cd backend && npm install && npm run dev` (→ http://localhost:4000);
   `cd frontend && npm install && npm run dev`.
6. **Accounts** — `npm run seed:accounts` (admin + user123 + driver123) and `npm run seed:admins`
   (Ruth, Nawaf). Health check: `curl http://localhost:4000/api/health`.

---

## 15. Demo playbook

**Golden rule — real vs demo:** demo data is created/removed by dedicated scripts and never
touches real bookings/orders.

- Seed a demo scenario: `npm run seed:demo` (then `seed:pay`, `seed:request` for specific states).
- Test accounts (pilot only — remove before launch): `admin123@smartmappia.com/admin123`,
  `user123@smartmappia.com/user123`, `driver123@smartmappia.com/driver123` (pre-approved).
- Walkthrough: sign in as passenger → book a ride → pay (upload any image) → sign in as admin →
  verify payment → sign in as driver → accept → share location → advance status → watch the
  passenger's live map. For food: admin adds a restaurant + menu → customer orders → admin
  verifies payment + accepts → rider is offered/accepts → picks up (photo) → delivers (photo).
- Remove demo data: `npm run seed:clean`.

---

## 16. Deployment / hosting / production

- **Supabase (standalone project):** migrations applied; three storage buckets; RLS enabled.
- **VPS (Hostinger, Ubuntu, KVM 2 / 8 GB):** Node 20 + PM2 runs the Express API (process
  `smartmappia-api`) behind Nginx with Let's Encrypt HTTPS; `api.smartmappia.com` → app on
  port 4000.
- **OSRM:** Docker container on the VPS (GCC-states map, bound to `127.0.0.1:5000`), exposed only
  through `/api/osrm`.
- **Frontend:** built to static files, served by Nginx for `smartmappia.com` + `www` over HTTPS.
- **DNS:** `api`, apex (`@`), and `www` point at the VPS (Hostinger DNS).

**Redeploy after a change:** Backend — pull, `npm install --omit=dev`, restart the PM2 process.
Frontend — pull, `npm run build` (Nginx serves the new `dist`).

**Android app (Capacitor):** wraps the existing web build (all API calls already target
`api.smartmappia.com`). Build machine needs Node 20+, JDK 17, Android Studio + SDK (Platform 34+).
Steps: install `@capacitor/{core,cli,android,geolocation}` → `npx cap init "Smart Mappia"
com.smartmappia --web-dir dist` → `npm run build` → `npx cap add android && npx cap sync` →
`npx cap open android` (or `./gradlew assembleDebug`). Manifest permissions:
`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `INTERNET`, `POST_NOTIFICATIONS`, optional
`CAMERA`. Native work: `@capacitor/geolocation` for driver GPS, FCM for push, in-app browser +
deep link for Tap later. If CORS errors appear, add the Capacitor origin (`https://localhost`) to
`CORS_ORIGINS`.

**App vs backend updates:** backend changes deploy freely (no new APK). A new APK is only needed
when the web bundle's baked-in config changes (e.g. `VITE_API_BASE`) or native plugins/permissions
change — so keep the API on a stable domain.

---

## 17. Security

Enforced today:
- **Helmet** security headers + **rate limiting** (global 120/min plus per-endpoint: proof upload
  10/min, public lookups 60/min, driver accept 20/min, driver location 30/min) — `backend/app.js`,
  `middleware/rateLimiters.js`. `trust proxy` on so limits key on the real client IP behind Nginx.
- **Central error handler + controller sanitization** — no raw DB/internal errors reach clients.
- **Env-configurable CORS** (`CORS_ORIGINS`; allow-all only when unset).
- **RLS ON for every table** (owner/driver/admin policies + `is_admin()`); public lookups via
  security-definer functions returning safe fields only; booking/order codes are unguessable +
  rate-limited against enumeration.
- **Payment auto-verify OFF** in prod; admin manual verification only.
- **Audit logging** of privileged actions (payment verify/reject, driver approval, merchant
  owner-link, credit changes, driver cancel/reclaim) to an immutable `audit_logs`.
- Private proof/doc buckets with short signed-URL TTLs; images-only validation for public images.
- Server-side input validation (`lib/validate.js`) rejecting unknown fields (anti mass-assignment).

Outstanding hardening before/around launch (from the security notes):
- **Rotate the Supabase `service_role` key** and confirm `frontend/.env` ships the **anon** key
  only (a past pass found the service_role key mistakenly in the frontend env — must be the anon
  key, and the service_role key rotated).
- **Re-enable driver verification in code** (drivers are auto-approved in `authController.js` for
  the pilot — revert at launch) and keep migration `0004` unapplied in prod.
- **Lock CORS** to the prod origin; **force HTTPS** (Nginx HTTP→HTTPS redirect).
- **Rotate/replace seed passwords** (`admin123`/`user123`/`driver123`) and remove test accounts.
- Compliance posture: TLS 1.3 in transit, AES-256 at rest, **PCI-DSS** (never store raw card data —
  tokens only) and **SDAIA** data-minimization/consent/retention. Add monitoring/alerting + a
  backup/restore plan. Full 50-point checklist preserved in
  [archive/production/SECURITY_TODO.md](archive/production/SECURITY_TODO.md).

---

## 18. Admin operations runbook

**Creating admins.** Two mechanisms, use both for a real admin:
1. Add the email to `ADMIN_EMAILS` in `backend/.env` (comma-separated) and restart the API.
2. Seed the account so it can log in: for the named admins,
   `cd backend && npm run seed:admins` creates/repairs **Ruth** (`ruth@smartmappia.com`) and
   **Nawaf** (`nawaf@smartmappia.com`), generating a **strong random password** for each and
   printing it once — hand it over privately and have them change it on first login. The default
   single admin is `npm run seed:admin` (from `ADMIN_SEED_EMAIL`/`_PASSWORD`). Re-running is
   idempotent (resets the password). To add more named admins, edit the `ADMINS` list in
   [`scripts/seed-admins.js`](../backend/scripts/seed-admins.js).

**Merchant onboarding + owner accounts.** Admin Food tab → "Add restaurant" (starts Unlisted) →
import menu/items (upload logo + photos) → contract signed → "Assign owner" (enter owner email;
creates/links the account, grants `merchant`) → flip **Listed**. Owner status is shown per row.

**Credit reconciliation (current model).** Watch each restaurant's 300 SAR credit; the 80% alert
fires once at 240; reaching 300 auto-suspends. "Reconcile" replenishes after the restaurant settles.

**Order / dispatch overrides.** Admins accept/reject/advance food orders, verify/reject payments,
cancel + mark refunded, and manually assign a rider (`assign-driver`) as a fallback to the
automatic cascade.

**Reviewing proofs/docs.** Payment proofs and rider pickup/delivery photos open via short-lived
signed URLs; driver KYC docs are reviewed per driver (Verify/Reject → auto-approve gate).

---

## 19. Testing / QA

- **Build/lint:** `cd backend && node --check <files>`; `cd frontend && npm install && npm run build`.
- **Rides:** book → pay (upload image) → admin verify → driver accept → GPS → advance → track;
  driver **cancel before start** → re-offered to next-nearest; **complete** → ledger written + rate.
- **Food:** add restaurant + menu (upload logo/photo, reject a PDF/oversized file) → order →
  min-order (< 30 SAR → 422) and radius (> 15 km → 422) checks → pay/cash → accept → rider offer →
  pickup photo → delivery photo → rate. Driver **cancel before pickup** and **GPS-stale watchdog**
  → re-dispatch to next rider; verify no double-assign.
- **Admin accounts:** `npm run seed:admins` prints two accounts; both appear as `role='admin'` in
  `profiles`; login lands on the admin portal.

---

## 20. Changelog (recent work)

- **Merchant image uploads** — restaurant logos + menu photos moved from pasted URLs to real file
  uploads via the new **public `merchant-images`** bucket (admin Food tab + merchant portal).
- **Admin owner-account provisioning** — `POST /api/admin/food/merchants/:id/owner` creates/links a
  restaurant owner account and grants the `merchant` role at contract signing.
- **Auto re-dispatch on cancel/disconnect** — driver "cancel" endpoints + disconnect watchdogs for
  **both** food deliveries and Pick & Drop rides (re-offers to the next-nearest driver; rides
  watchdog is scheduled-ride-aware).
- **Foodpanda-style tracking** — the food tracking page gained an ETA hero + progress bar, an
  order-details block, a cleaner receipt with "Paid with", and a "finding a rider" state; built as
  reusable components for the upcoming ecommerce order-status page.
- **Docs consolidation** — this master doc + the complete food doc; historical docs archived.

---

## 21. Roadmap / wishlist

- **Ecommerce service** (next) — reuse the food order-status/tracking components.
- **Food pricing v2** — migration `0017`: customer-pays-the-markup + payout ledger (approved,
  pending; must ship atomically with the `acceptOrder` change).
- **Native push (FCM)** server-side delivery + the Android app.
- **Tap Payments** go-live (create-charge + signature-verified webhook).
- **Launch hardening** — rotate `service_role` key, remove test accounts, re-enable driver
  verification, lock CORS, force HTTPS, add monitoring + backups.
- **Merchant portal** deepening and a merchant-facing login destination for owner accounts.
