# Smart Mappia — Backend Guide

Hey 👋 — this is the field guide to the Smart Mappia backend. It powers the Airport
Pick & Drop service: booking a ride, paying by STC Pay, matching a nearby driver
Grab-style, and tracking the trip live.

The stack is deliberately boring (in a good way): **Node.js 20 + Express**, plain
JavaScript (CommonJS), on top of **Supabase** (Postgres + Auth + private Storage). No
TypeScript, no build step. The exact same Express app runs two ways — `server.js` on your
laptop, and `api/index.js` as a Vercel serverless function — so what you test locally is
what ships.

> **Before you go live, read [§9 Test mode → Production](#9-test-mode--production).** Out of
> the box the system is in a *testing* posture: payments auto-verify and driver payouts are
> simulated. Great for demos, dangerous for real money.

---

## Table of contents

1. [How a request flows](#1-how-a-request-flows)
2. [Where everything lives](#2-where-everything-lives)
3. [Environment variables](#3-environment-variables)
4. [The data model](#4-the-data-model)
5. [The life of a booking](#5-the-life-of-a-booking)
6. [Authentication & roles](#6-authentication--roles)
7. [Real-time updates](#7-real-time-updates)
8. [Uploading payment proof](#8-uploading-payment-proof)
9. [API reference](#9-api-reference)
10. [Test mode → Production](#10-test-mode--production)
11. [Running it locally & deploying](#11-running-it-locally--deploying)
12. [Known gaps & what's next](#12-known-gaps--whats-next)

---

## 1. How a request flows

Every request walks the same short path. Routes do the plumbing, controllers stay thin
(validate input, shape the response), and the real thinking happens in `lib/`.

```
Browser / WhatsApp link
        │  HTTPS (JSON, with a Bearer token when signed in)
        ▼
┌──────────────────────────────────────────────────────────┐
│ Express app (app.js)  —  cors() + express.json()           │
│   /api/health    health.js                                 │
│   /api/auth      auth.js      (verify Supabase token)      │
│   /api/bookings  bookings.js  (book, pay, track, cancel)   │
│   /api/tracking  tracking.js  (public live tracking)       │
│   /api/admin     admin.js     (requireAdmin)               │
│   /api/driver    driver.js    (requireDriver / approved)   │
└──────────────────────────────────────────────────────────┘
        │  controllers — thin: validate + respond
        ▼
┌──────────────────────────────────────────────────────────┐
│ lib/ — where the logic actually lives                      │
│   config.js   reads & defaults every env var               │
│   supabase.js the service-role client                      │
│   fare.js     the fare snapshot (base + service fee)       │
│   payments.js the verify / reject state machine            │
│   ledger.js   commission + payout math, and the write      │
│   storage.js  signed URLs for proof images                 │
│   tracking.js appends timeline events                      │
│   realtime.js pushes live updates to the browser           │
│   geo.js      distance + ETA (nearest-driver matching)     │
└──────────────────────────────────────────────────────────┘
        │  service-role key (bypasses RLS)
        ▼
   Supabase Postgres + Storage + Realtime
```

A few principles worth internalizing:

- **Controllers stay thin.** If you're tempted to write business logic in a controller,
  it probably belongs in `lib/` so it can be reused and tested.
- **The server holds the service-role key**, which bypasses Row-Level Security. That's the
  whole point — the trusted backend does sensitive writes (verifying payments, paying
  drivers). This key must *never* reach the browser.
- **It's stateless.** Nothing lives in memory between requests, because serverless functions
  can spin up and die at any moment.
- **Files skip the server entirely.** Proof images go straight from the browser to Supabase
  Storage via a signed URL. We only store the path.
- **The fare is a snapshot.** It's computed once when the booking is created and never
  recalculated, so the price a passenger agreed to can't drift.

---

## 2. Where everything lives

```
backend/
├── api/index.js                 # Vercel entrypoint (exports the Express app)
├── controllers/
│   ├── authController.js         # profile sync + automatic-admin rule
│   ├── bookingsController.js     # create booking, get summary, cancel
│   ├── paymentsController.js     # payment instructions + proof upload/record
│   ├── trackingController.js     # public timeline, ETAs, live driver position
│   ├── adminController.js        # bookings, verify/reject, assign + approve drivers
│   └── driverController.js       # available feed, accept, location, status updates
├── middleware/
│   └── auth.js                   # verify Supabase JWT -> role + driver approval
├── lib/
│   ├── supabase.js               # service-role client (server only)
│   ├── config.js                 # every env knob, parsed in one place
│   ├── fare.js                   # SAR 100 base + 3.75% service fee = 103.75 snapshot
│   ├── storage.js                # signed upload/download URLs for proofs
│   ├── tracking.js               # tracking_events helper
│   ├── payments.js               # verify/reject state machine (shared)
│   ├── ledger.js                 # commission/payout math + ledger write
│   ├── realtime.js               # Supabase Realtime broadcast helpers
│   └── geo.js                    # haversine distance + ETA estimate
├── routes/
│   ├── health.js  auth.js  bookings.js  tracking.js  admin.js  driver.js
├── app.js                        # the Express app (middleware + routes)
├── server.js                     # local runner (app.listen)
├── vercel.json                   # routes all requests to api/index.js
├── package.json   .env.example
<<<<<<< HEAD
├── 0001_init_smart_mappia.sql    # base schema (run once)
├── 0002_auth_driver_approval.sql # adds the driver-approval flag (run once)
=======
├── migrations/
│   ├── 0001_init_smart_mappia.sql            # base schema (run once)
│   ├── 0002_auth_driver_approval.sql         # adds the driver-approval flag (run once)
│   ├── 0003_profile_registration_fields.sql  # sign-up extra fields (run once)
│   └── utilities/profile-roles.sql           # inspect/fix a stuck role (not auto-run)
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
├── README.md                     # quick start
└── DOCUMENTATION.md              # you are here
```

---

## 3. Environment variables

Everything funnels through [`lib/config.js`](lib/config.js) — controllers never touch
`process.env` directly. Locally these come from `.env`; on Vercel, from the dashboard.

| Variable | Required | Default | What it's for |
|---|---|---|---|
| `SUPABASE_URL` | ✅ | — | Your project URL. The app **refuses to boot** without it. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | The powerful server-only key. Also boot-critical. Keep it secret. |
| `PORT` | — | `4000` | Local port (Vercel ignores it). |
| `AUTO_VERIFY_STCPAY_TEST_MODE` | — | `false`* | **The test switch.** `true` = every uploaded proof auto-verifies and payouts are simulated. |
| `PAYMENT_MODE` | — | `stcpay_manual` | A label, mostly informational. |
| `SMART_MAPPIA_STCPAY_NUMBER` | ✅ (prod) | `''` | The STC Pay number passengers send money to. |
| `SMART_MAPPIA_STCPAY_NAME` | — | `Smart Mappia` | Recipient name shown to passengers. |
| `ADMIN_EMAILS` | ✅ (prod) | `''` | Comma-separated emails that auto-become admins on sign-in. |
| `PAYMENT_PROOF_BUCKET` | — | `payment-proofs` | The **private** Storage bucket for receipts. |
| `PAYMENT_PROOF_UPLOAD_TTL` | — | `900` | Seconds a signed upload URL stays valid. |
| `PAYMENT_PROOF_DOWNLOAD_TTL` | — | `3600` | Seconds a signed download URL (admin review) stays valid. |
| `PAYMENT_PROOF_MAX_BYTES` | — | `10485760` | Max proof size (10 MB). |
| `PLATFORM_COMMISSION_RATE` | — | `0.20` | Platform's cut as a fraction (0.20 = 20%). |
| `MANUAL_PAYMENT_FEE` | — | `0` | Fixed per-trip processing fee in SAR. |

\* **A gotcha worth flagging:** `config.js` defaults this to `false`, but the shipped
`.env.example` sets it to `true`. So if you copy the example file for local dev, you're in
test mode. In production, set it **explicitly** to `false` rather than trusting the default.
More on this in §10.

> The old `ADMIN_API_KEY` / `DRIVER_API_KEY` shared secrets are **gone** — auth now runs on
> Supabase JWTs (see §6). You can delete them from any old `.env`.

---

## 4. The data model

<<<<<<< HEAD
The full schema is in [`0001_init_smart_mappia.sql`](0001_init_smart_mappia.sql), with the
driver-approval flag added by [`0002_auth_driver_approval.sql`](0002_auth_driver_approval.sql).
=======
The full schema is in [`migrations/0001_init_smart_mappia.sql`](migrations/0001_init_smart_mappia.sql),
with the driver-approval flag added by
[`migrations/0002_auth_driver_approval.sql`](migrations/0002_auth_driver_approval.sql) and the extra
sign-up fields by
[`migrations/0003_profile_registration_fields.sql`](migrations/0003_profile_registration_fields.sql).
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
Run both once in the Supabase SQL editor. The tables:

| Table | What it holds |
|---|---|
| `profiles` | One row per user: app role (`passenger`/`driver`/`admin`), contact info, and `driver_approved`. Linked to `auth.users`. |
| `bookings` | The heart of it all — trip details, the fare snapshot, payment + booking status, the assigned driver, ETA fields. |
| `payment_proofs` | One row per uploaded receipt (its path in the private bucket, hash, review status). |
| `payments` | One row per verified payment (amount, provider, who verified it and how). |
| `tracking_events` | An append-only timeline that drives the tracking page. |
| `driver_locations` | Live GPS pings — used for the nearest-driver feed and live ETAs. |
| `ledger_entries` | Commission + driver payout, written once a trip completes. |

### The status vocabulary

Three status fields tell the whole story of a trip. They move roughly left-to-right:

- **`payment_status`** — `awaiting_proof` → `proof_uploaded` → `under_review` → `verified` | `rejected` | `refunded`
- **`booking_status`** — `pending_payment` → `payment_under_review` → `confirmed` → `driver_assigned` → `driver_on_the_way` → `arrived` → `in_progress` → `completed` | `cancelled`
- **`driver_ride_status`** — `assigned` → `accepted` → `on_the_way` → `arrived` → `started` → `completed` | `cancelled`

Plus a few supporting ones: `verification_mode` (`test_auto` | `admin_manual` | `moyasar_webhook`),
`proof_status`, and `payout_status` (`pending` | `simulated_test` | `paid` | `cancelled`).

### A word on security (RLS)

Every table has Row-Level Security **on**. Regular users (anon or logged-in) can only read
their own rows. The backend sidesteps RLS with the service-role key so it can do trusted work,
and public tracking is served by the API with only safe fields — so internal UUIDs never leak
to the browser.

---

## 5. The life of a booking

Here's the whole journey, from "I need a ride" to "the driver got paid":

```
Passenger signs in, then POST /api/bookings        (must be authenticated)
  payment_status = awaiting_proof
  booking_status = pending_payment
  user_id = the signed-in passenger
  → timeline: "booking_created"
        │
        ▼
GET payment-instructions   (STC Pay number, amount, booking code as the reference)
        │
        ▼
POST payment-proof/signed-url → browser uploads the screenshot to Storage
        │
        ▼
POST payment-proof   (records the proof)
  payment_status = proof_uploaded · booking_status = payment_under_review
  → timeline: "proof_uploaded"   → realtime ping to the passenger + admin
        │
        ├── TEST MODE (AUTO_VERIFY=true) ─── auto-verifies instantly
        │
        └── PRODUCTION ── an admin reviews the screenshot and clicks Verify
                          (POST /api/admin/.../verify-payment)
        ▼
  payment_status = verified · booking_status = confirmed
  + a payments row, proof marked verified, confirmed_at set
  → timeline: "payment_verified"
  → realtime: passenger hears "confirmed"; the ride is broadcast to the driver feed
        │
        ▼
A nearby driver taps Accept   (POST /api/driver/rides/:code/accept)
  This is an ATOMIC claim — only succeeds while the ride is still unassigned,
  so two drivers can never grab the same one.
  driver_ride_status = accepted · booking_status = driver_assigned
  → realtime: passenger sees their driver + contact; ride leaves the open feed
        │
        ▼
Driver progresses the ride   (POST /api/driver/rides/:code/status)
  on_the_way → arrived → started → completed
  Each step updates booking_status and pings the passenger.
  While active, the driver's GPS (POST /api/driver/location) is pushed live so the
  passenger sees the car move and an ETA tick down.
        │
        ▼  (status = completed)
  booking_status = completed
  → a ledger_entries row is written: commission + driver payout
  payout_status = simulated_test (test mode) | pending (production)
```

At any point before the trip is underway, the passenger can **cancel**
(`POST /api/bookings/:code/cancel`) — that flips the booking to `cancelled` and pulls it
from the driver feed.

Two paths can verify a payment — the test-mode auto-verify and the admin manual verify — and
they deliberately share the **same** code in `lib/payments.js`, so the status transitions are
defined exactly once. Same idea for assigning a driver: the Grab-style self-accept and the
admin's manual `assign-driver` both land in the same place.

**Driver status → booking status** (from `driverController.js`):

| driver_ride_status | becomes booking_status |
|---|---|
| `accepted` | `driver_assigned` |
| `on_the_way` | `driver_on_the_way` |
| `arrived` | `arrived` |
| `started` | `in_progress` |
| `completed` | `completed` (+ ledger entry) |
| `cancelled` | `cancelled` |

---

## 6. Authentication & roles

Auth runs on **Supabase Auth** (email + password). The frontend signs the user in, then sends
the access token as `Authorization: Bearer <jwt>` on every request. The backend verifies that
token and looks up the matching `profiles` row to learn the user's role.

The whole thing lives in [`middleware/auth.js`](middleware/auth.js), which exposes a small
ladder of guards:

| Guard | Lets through | Sets |
|---|---|---|
| `requireToken` | any valid token (profile may not exist yet) | `req.authUser` |
| `requireAuth` | valid token **and** an existing profile | `req.userId`, `req.role`, `req.profile` |
| `requireAdmin` | `requireAuth` + role `admin` | `req.adminId` |
<<<<<<< HEAD
| `requireDriver` | `requireAuth` + role `driver` | `req.driverId` |
| `requireApprovedDriver` | `requireDriver` + `driver_approved = true` | — |
=======
| `requireDriver` | `requireAuth` + role `driver` **or `admin`** | `req.driverId` |
| `requireApprovedDriver` | `requireDriver` + `driver_approved = true` (admin skips approval) | — |

> **Admin passes the driver guards on purpose.** An admin can act through the user and driver
> screens via the dashboard "View" switch (preview mode) without logging out, so `requireDriver`
> and `requireApprovedDriver` let `admin` through. Real auth is unchanged — this only widens what
> the existing admin token may do. Anything the admin does while previewing writes real data (an
> accepted ride is assigned to the admin account). `requireAdmin` stays admin-only.
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86

### The three roles

- **Passenger (Rider)** — the default. Must be signed in to create or cancel a booking.
- **Driver** — can sign up and sign in right away, but lands in a "pending" state. They can't
  see the open ride feed or accept anything until an admin approves them. That's the
  `driver_approved` flag, and it's why driving routes split between `requireDriver` (view your
  own rides) and `requireApprovedDriver` (the feed, accepting, posting location).
- **Admin** — granted **automatically** to any account whose email is listed in `ADMIN_EMAILS`.
  There's no admin sign-up form, and you can't self-promote — the role comes only from that env
  list (or from an existing admin profile).

### Profile sync (the automatic-admin bit)

Right after a user signs in, the frontend calls `POST /api/auth/sync` once. That endpoint
([`authController.js`](controllers/authController.js)) upserts the `profiles` row from the
verified token plus whatever role/details the user picked at signup, and applies the
admin-email rule. The body can ask for `passenger` or `driver` — never `admin`; that's the one
role the request body can't grant.

### Creating your first admin (and how sign-in actually flows)

Here's the mental model that saves a lot of head-scratching: **signing in talks straight to
Supabase, not to this backend.** The browser calls Supabase Auth directly, and our server only
hears about it *afterwards*, when the frontend posts the token to `/api/auth/sync`. So a
"wrong email or password" error is Supabase telling you it doesn't recognize that account — it
is *never* a sign that the Express backend is down.

That also means dropping an email into `ADMIN_EMAILS` doesn't **create** a login — it only
**promotes** an account to admin once that account exists and signs in. You still have to make
the user first. Two easy ways:

**Option A — the seeder (the simplest way to get your first admin):**
```bash
cd backend
npm run seed:admin
```
This creates the user from `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` (defaults
`admin123@smartmappia.com` / `admin123`), marks its email as already confirmed, and sets the
profile to admin. It's idempotent — re-running just resets the password. Then sign in at
`/login`.

**Option B — just sign up:** go to `/signup`, register the admin email with a password. Because
that email is in `ADMIN_EMAILS`, the very next sign-in flips it to admin automatically. This
only works if you've turned **off** "Confirm email" in Supabase (Auth → Providers → Email) —
otherwise you'll need to click the confirmation link first. (Option A skips that headache by
pre-confirming the email for you.)

### When sign-in won't cooperate

A quick triage for the usual suspects:

- **"Auth is not configured…"** — the *frontend* has no Supabase keys. Set `VITE_SUPABASE_URL`
  and `VITE_SUPABASE_ANON_KEY` in **`frontend/.env`** (the anon/public key — never the
  service-role one), then restart `npm run dev`. Vite only reads env at startup.
- **"Invalid login credentials"** — Supabase doesn't have that email + password combo. Usually
  the account just hasn't been created yet → run the seeder or sign up (above). Worth
  double-checking the password, too.
- **"Email not confirmed"** — the user exists but hasn't confirmed. Click the email link, turn
  off "Confirm email", or use the seeder (which pre-confirms).
- **"Profile not set up…"** (this one's from *our* backend) — the token is valid but there's no
  `profiles` row yet. Make sure the migrations (`0001`, `0002`, `0003`) have run, then sign out and back
  in so `/api/auth/sync` can create the row. Run `npm run check:migrations` in `backend/` to verify.

---

## 7. Real-time updates

Passengers book as guests-of-sorts (their profile exists, but Postgres RLS won't stream row
changes to an anonymous browser without leaking internal IDs). So instead of `postgres_changes`,
the server **pushes** updates over Supabase **Realtime Broadcast** — a stateless HTTP call from
[`lib/realtime.js`](lib/realtime.js). The browser only ever *subscribes*.

Channels are keyed by public data, and every payload carries only safe fields (never the booking
UUID):

| Channel | Who listens | What it carries |
|---|---|---|
| `booking-<code>` | the one passenger tracking that booking | status changes, driver contact, live driver location + ETA |
| `drivers-available` | every online driver | `new_request` (a ride opened up) and `request_taken` (it's gone) |
| `admin-bookings` | the admin dashboard | a generic "something changed" ping |

Broadcasts are best-effort and never block the request — if Realtime is misconfigured, the
frontend quietly falls back to polling. Worst case the UI is a few seconds slower, never broken.

---

## 8. Uploading payment proof

The receipt image never touches this server — it goes browser → Storage directly. Three steps:

**1 — ask for a signed upload URL**
```
POST /api/bookings/SM-XXXX/payment-proof/signed-url
{ "file_name": "receipt.jpg", "mime_type": "image/jpeg" }

→ 201 { bucket, path, token, signedUrl, maxBytes, next }
```
Allowed types: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.

**2 — the browser uploads straight to Supabase Storage**
```js
await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file);
```

**3 — tell the backend it's there**
```
POST /api/bookings/SM-XXXX/payment-proof
{ "path": "<from step 1>", "file_name": "...", "mime_type": "image/jpeg",
  "size_bytes": 84213, "file_hash": "<sha256, optional>" }

→ 201 { bookingCode, proofId, paymentStatus, bookingStatus, autoVerified }
```
The backend checks the `path` actually belongs to this booking, records the proof, moves the
booking into "under review", and — **only in test mode** — auto-verifies on the spot.

Admins later view receipts through short-lived signed **download** URLs returned by the booking
detail endpoint.

---

## 9. API reference

Errors always come back as `{ "error": "message" }` (validation also adds `details: [...]`).
"🔒" marks routes that need a `Bearer` token.

### Auth

#### `POST /api/auth/signup` (public)
Creates the account server-side with its **email already confirmed** (no confirmation email),
so new users can sign in immediately. The frontend signs in right after, then calls `/sync`.
- **Body (required):** `email`, `password` (≥6 chars). **Optional:** `full_name`, `whatsapp_number`, `mobile_number`
- **201** `{ id, email }` · **400** validation · **409** email already exists
- Role is *not* set here — it's chosen at `/sync`. The body can never grant `admin`.

#### 🔒 `POST /api/auth/sync`
Upsert the caller's profile from their token + chosen role. Called right after signup/login.
- **Body (optional):** `role` (`passenger`|`driver`), `full_name`, `whatsapp_number`, `mobile_number`
- **200** `{ id, role, fullName, whatsapp, mobile, email, driverApproved }`
- **401** no/!valid token

### Passenger

#### 🔒 `POST /api/bookings`
Create a booking (requires sign-in). The fare is a flat **SAR 100 base + 3.75% service fee =
SAR 103.75**; `route_type` is accepted but ignored.
- **Body (required):** `trip_type` (`house_to_airport`|`airport_to_house`), `pickup_address`,
  `dropoff_address`, `pickup_datetime` (ISO), `passenger_name`, `passenger_whatsapp`
- **Optional:** `airport_terminal`, `pickup_lat/lng`, `dropoff_lat/lng`, `passenger_count`,
  `luggage_count`, `notes`, `passenger_mobile`, `passenger_email`
- **201** `{ bookingCode, fareAmount, currency, bookingStatus, paymentStatus, paymentMethod, next }`
- **400** validation · **401** not signed in · **500** server error

#### `GET /api/bookings/:bookingCode`
Booking summary. **200** booking fields · **404** not found.

#### 🔒 `POST /api/bookings/:bookingCode/cancel`
Cancel a booking (owner or admin only). **Body (optional):** `reason`.
- **200** `{ bookingCode, bookingStatus }` · **403** not yours · **404** · **409** too late to cancel

#### `GET /api/bookings/:bookingCode/payment-instructions`
- **200** `{ bookingCode, paymentMethod, paymentStatus, amount, currency, fare:{base, serviceFeePercent, serviceFee, total}, stcPay:{number, recipientName}, reference, instructions:[...], testMode }`
- **404** not found

#### `POST /api/bookings/:bookingCode/payment-proof/signed-url`
- **201** `{ bucket, path, token, signedUrl, maxBytes, next }`
- **400** bad `mime_type` · **404** · **409** payment not in a payable state

#### `POST /api/bookings/:bookingCode/payment-proof`
- **201** `{ bookingCode, proofId, paymentStatus, bookingStatus, autoVerified }`
- **400** validation · **404** · **409** non-payable state · **500** save/verify error

#### `GET /api/tracking/:bookingCode`
Public live tracking (safe fields only — no internal IDs).
- **200** `{ bookingCode, tripType, pickup*/dropoff* (address + lat/lng), paymentStatus, bookingStatus, driverRideStatus, etas, driver:{name,whatsapp}|null, driverLocation:{lat,lng,at}|null, liveEtaMinutes, timeline:[{type,title,message,at}] }`
- **404** not found

#### `GET /api/health`
- **200** `{ status, db, testMode, paymentMode, time }`

### Admin (🔒 role `admin`)

#### `GET /api/admin/stats`
Dashboard overview — totals, revenue, status breakdowns, driver counts.
- **200** `{ totals:{ bookings, completed, cancelled, active, today, revenue, currency, needsReview, awaitingPayment }, drivers:{ total, approved, pending }, bookingsByStatus:{…}, paymentsByStatus:{…}, generatedAt }`

#### `GET /api/admin/bookings`
Filters: `booking_status`, `payment_status`, `limit` (≤200, default 50), `offset`.
- **200** `{ total, limit, offset, bookings:[...] }`

#### `GET /api/admin/bookings/:bookingCode`
- **200** `{ booking, proofs:[{...,downloadUrl}], payments:[...] }` (proofs carry signed download URLs)
- **404** not found

#### `POST /api/admin/bookings/:bookingCode/verify-payment`
Body (optional): `manual_reference`. **200** `{ bookingCode, paymentStatus, bookingStatus }` · **409** already verified

#### `POST /api/admin/bookings/:bookingCode/reject-payment`
Body (required): `reason`. **200** updated statuses · **400** missing reason · **409** already verified

#### `POST /api/admin/bookings/:bookingCode/assign-driver`
Body (required): `driver_id`. **200** updated statuses · **409** payment not verified yet
*(This is the manual fallback; normally drivers self-accept.)*

#### `GET /api/admin/drivers`
- **200** `{ drivers:[{ id, full_name, email, whatsapp_number, driver_approved, ... }] }`

#### `POST /api/admin/drivers/:driverId/approval`
Body: `approved` (defaults to `true`). Approve or revoke a driver.
- **200** `{ id, fullName, driverApproved }` · **404** not a driver

### Driver (🔒 role `driver`)

#### `GET /api/driver/available` — *approved drivers only*
The open feed: verified, confirmed, still-unassigned rides, nearest first. Pass `lat` & `lng`
to sort by distance.
- **200** `{ rides:[{ booking_code, pickup*/dropoff*, fare_amount, distanceKm, etaMinutes, ... }] }`

#### `POST /api/driver/rides/:bookingCode/accept` — *approved drivers only*
Atomically claim a ride. **200** `{ bookingCode, bookingStatus, driverRideStatus, driver }` ·
**409** already taken / not ready

#### `POST /api/driver/location` — *approved drivers only*
Body: `lat`, `lng`, `accuracy?`. Stores the ping and pushes it live to any active ride.
- **200** `{ ok: true }` · **400** missing coords

#### `GET /api/driver/rides`
Your assigned rides. Optional filter `driver_ride_status`. **200** `{ rides:[...] }`

#### `POST /api/driver/rides/:bookingCode/status`
Body: `status` ∈ `accepted|on_the_way|arrived|started|completed|cancelled`.
- **200** `{ bookingCode, driverRideStatus, bookingStatus, ledger }` (`ledger` is non-null only on completion)
- **403** not your ride · **409** already completed

---

## 10. Test mode → Production

This is the section to slow down on. Out of the box the backend is in a **testing posture**;
here's exactly what to change before real customers and real money show up.

### What test mode actually does

With `AUTO_VERIFY_STCPAY_TEST_MODE=true`:
- **Every uploaded proof is auto-verified instantly.** No human checks the money landed — the
  booking jumps straight to `confirmed`.
- **Payouts are marked `simulated_test`** (not real money owed).

Perfect for end-to-end demos. **Catastrophic in production** — someone could upload a blank
image and get a free confirmed ride.

### The must-do list before going public

| # | Change | Where | Why it matters |
|---|---|---|---|
| 1 | **`AUTO_VERIFY_STCPAY_TEST_MODE=false`** | env | The single most important switch. Forces real admin review; payouts become `pending` (real). |
| 2 | Real `SMART_MAPPIA_STCPAY_NUMBER` + `_NAME` | env | Passengers must pay the correct account. |
| 3 | Set `ADMIN_EMAILS` to your real admin addresses | env | That's how admin access is granted now. |
| 4 | Confirm `PLATFORM_COMMISSION_RATE` / `MANUAL_PAYMENT_FEE` | env | These decide what drivers actually get paid — check with finance. |
| 5 | Create the **private** `payment-proofs` bucket | Supabase | Proof uploads fail without it; private so receipts aren't public. |
<<<<<<< HEAD
| 6 | Run both migrations (`0001`, `0002`) and confirm RLS is on | Supabase | Schema + the driver-approval flag + table protection. |
=======
| 6 | Run all three migrations from `migrations/` (`0001`, `0002`, `0003`) and confirm RLS is on | Supabase | Schema + the driver-approval flag + sign-up fields + table protection. |
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
| 7 | Turn **off** "Confirm email" or wire up the email flow | Supabase Auth | Decides whether new signups get a session immediately. |
| 8 | **Lock down CORS** | `app.js` | `cors()` currently allows every origin — restrict to your frontend domain. |
| 9 | Put **all** env vars in the Vercel dashboard | Vercel | Serverless reads env from there, not your local `.env`. |
| 10 | Double-check the **service-role key is backend-only** | review | It bypasses RLS; it must never end up in a frontend bundle. |
<<<<<<< HEAD
=======
| 11 | Decide whether **admin should still pass the driver guards** | `middleware/auth.js` | The admin "View" preview lets admin act as a driver. Keep it for an internal tool; remove the `\|\| role === 'admin'` allowances if real admins shouldn't accept rides. |
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86

### Worth doing soon after launch

- **Make verify / complete atomic.** Supabase-JS can't do multi-table transactions, so
  `lib/payments.js` and `lib/ledger.js` write step-by-step and bail on the first error. Moving
  these into Postgres functions (RPCs) removes any chance of a half-finished verify.
- **Separate "simulated payout" from the test flag.** Right now `payout_status` keys off the
  same auto-verify flag. A dedicated `PAYOUTS_SIMULATED` flag lets you verify for real while
  still simulating payouts during a soft launch.
- **Enforce proof anti-reuse.** The schema stores and indexes `file_hash`, but nothing rejects a
  re-used hash yet. A quick lookup in `recordPaymentProof` closes that.
- **Rate-limit public POSTs** (booking, proof) to deter abuse.
- **Real logging/alerting** instead of `console.error`, so a failed verification gets noticed.

### Quick gut-check: am I still in test mode?

Hit `GET /api/health` — `testMode` should be `false`. Then make a real booking and upload a
proof: the response should say `"autoVerified": false` with `paymentStatus: "proof_uploaded"`,
meaning it's waiting on an admin. If `autoVerified` is `true`, you're still in test mode.

---

## 11. Running it locally & deploying

### Local

```bash
cd backend
cp .env.example .env        # fill in your Supabase values + ADMIN_EMAILS
npm install
npm run dev                 # node --watch server.js → http://localhost:4000
```

<<<<<<< HEAD
One-time Supabase setup: run `0001_init_smart_mappia.sql` then
`0002_auth_driver_approval.sql` in the SQL editor, create the private `payment-proofs` bucket,
and (for an easy MVP) turn off "Confirm email" under Auth → Providers.
=======
One-time Supabase setup: run the three files in `migrations/` (`0001_init_smart_mappia.sql`,
`0002_auth_driver_approval.sql`, `0003_profile_registration_fields.sql`) in the SQL editor, create
the private `payment-proofs` bucket, and (for an easy MVP) turn off "Confirm email" under
Auth → Providers.
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86

Smoke-test it:
```bash
curl http://localhost:4000/api/health
```

### Vercel

`vercel.json` rewrites every request to `api/index.js`, which exports the same Express app you
run locally. Push the folder, import it in Vercel, and add **all** the env vars in the dashboard
(`dotenv` is a no-op there — the platform provides env). The frontend deploys separately.

---

## 12. Known gaps & what's next

Being honest about the edges:

- **No multi-table transactions** — verify/complete write sequentially. Postgres RPCs are the fix.
- **Payout simulation is tied to the test flag** — give it its own flag.
- **Proof anti-reuse (`file_hash`) isn't enforced** in code yet.
- **No Moyasar (card) flow** — the schema/enums are ready (`payment_method = moyasar`,
  `verification_mode = moyasar_webhook`), but the handlers aren't built.
- **ETAs are estimates** from straight-line distance ÷ an assumed city speed (`lib/geo.js`),
  not real road routing.
- **Driver approval is all-or-nothing** — no document upload / vetting workflow yet, just a flag.
- **No automated tests** — it's syntax-checked and smoke-tested by hand for now.

Found something out of date while reading this? Update it — a doc that drifts from the code is
worse than no doc. 🙂
```
