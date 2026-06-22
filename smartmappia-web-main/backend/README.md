# Smart Mappia — Backend

Hey 👋 — this is the backend for Smart Mappia's Airport Pick & Drop. It handles booking a
ride, paying by STC Pay, matching a nearby driver Grab-style, and tracking the trip live.

It's **Node.js + Express** (plain JavaScript, no build step) on **Supabase** (Postgres + Auth
+ private Storage). The same app runs on your laptop (`server.js`) and as a Vercel serverless
function (`api/index.js`).

> This README is the quick start. For the deep dive — architecture, the full API, the data
> model, and the go-live checklist — see **[DOCUMENTATION.md](DOCUMENTATION.md)**. The frontend
> portals are documented in **[../frontend/PORTALS.md](../frontend/PORTALS.md)**.

---

## What's built

**Auth**
- `POST /api/auth/sync` — after a Supabase login, creates/updates the user's profile and role

**Passenger**
- `POST /api/bookings` — create a booking (requires sign-in; fare snapshot + booking code)
- `GET  /api/bookings/:code` — booking summary
- `POST /api/bookings/:code/cancel` — cancel (owner only)
- `GET  /api/bookings/:code/payment-instructions` — STC Pay details + the fare breakdown
- `POST /api/bookings/:code/payment-proof/signed-url` — get a signed upload URL
- `POST /api/bookings/:code/payment-proof` — record the uploaded proof (auto-verifies in test mode)
- `GET  /api/tracking/:code` — public live tracking (timeline, ETAs, driver position)

**Admin**
- `GET  /api/admin/bookings` and `/:code` — list / detail (with signed proof URLs)
- `POST /api/admin/bookings/:code/verify-payment` · `/reject-payment` · `/assign-driver`
- `GET  /api/admin/drivers` and `POST /api/admin/drivers/:id/approval` — approve/revoke drivers

**Driver**
- `GET  /api/driver/available` — the open feed of nearby unclaimed rides (approved drivers)
- `POST /api/driver/rides/:code/accept` — atomically claim a ride
- `POST /api/driver/location` — share live GPS
- `GET  /api/driver/rides` — your assigned rides
- `POST /api/driver/rides/:code/status` — advance the ride (completion writes the payout)

### How auth works

Real accounts via **Supabase Auth** (email + password). The frontend signs the user in and
sends the access token as `Authorization: Bearer <jwt>`; the backend verifies it and reads the
role from the `profiles` table.

- **Passengers** must be signed in to book.
- **Drivers** can sign up immediately but stay *pending* until an admin approves them — only
  then can they see the feed or accept rides.
- **Admins** aren't a signup option. Any account whose email is in `ADMIN_EMAILS` becomes an
  admin automatically on sign-in.
<<<<<<< HEAD
=======
- An **admin also passes the driver guards** (`requireDriver` / `requireApprovedDriver`). This
  backs the admin "View" switch, which lets an admin try the user and driver screens without
  logging out. It's a testing convenience — see the admin-preview note in `DOCUMENTATION.md`.
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86

*(The old `x-admin-key` / `x-driver-key` shared-secret headers are gone — JWT replaced them.)*

---

## Get it running

### 1. Set up the database (once)

<<<<<<< HEAD
In your Supabase project, open **SQL Editor → New query**, then run these two files in order:

1. `0001_init_smart_mappia.sql` — all the tables, statuses, and security rules
2. `0002_auth_driver_approval.sql` — adds the driver-approval flag
=======
In your Supabase project, open **SQL Editor → New query**, then run these three files from
`migrations/` in order:

1. `migrations/0001_init_smart_mappia.sql` — all the tables, statuses, and security rules
2. `migrations/0002_auth_driver_approval.sql` — adds the driver-approval flag
3. `migrations/0003_profile_registration_fields.sql` — sign-up extras (date of birth, vehicle, etc.)

Run `npm run check:migrations` afterwards to confirm all three are applied.
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86

### 2. A few Supabase switches

- **Storage** — create a **private** bucket named `payment-proofs` (Storage → New bucket,
  "Public" off). Proof images upload straight from the browser to this bucket via a signed URL;
  they never touch the server.
- **Auth** — for a frictionless MVP, turn **off** "Confirm email" (Auth → Providers → Email) so
  new signups get a session right away.

### 3. Configure your environment

```bash
cp .env.example .env
```

Then fill in:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Dashboard → Project Settings → API)
- `ADMIN_EMAILS` — comma-separated emails that should be admins (e.g. `you@example.com`)
- `SMART_MAPPIA_STCPAY_NUMBER` — the number passengers send money to

Leave `AUTO_VERIFY_STCPAY_TEST_MODE=true` while you're testing (it auto-verifies payments).
**Flip it to `false` before going live** — see the go-live section in DOCUMENTATION.md.

### 4. Install and run

```bash
npm install
npm run dev
```

You should see `Smart Mappia API running on http://localhost:4000`.

<<<<<<< HEAD
### 5. Create the admin account

```bash
npm run seed:admin
```

This creates a ready-to-use admin (default `admin123@smartmappia.com` / `admin123`, set by
`ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`) with its email pre-confirmed, and marks the profile
as admin. It's idempotent — re-running just resets the password. Then sign in at `/login` with
those credentials.

> These are **test credentials** — change them before production, and keep the email in sync
> with `ADMIN_EMAILS`.
=======
### 5. Create the test accounts

```bash
npm run seed:accounts
```

This creates three ready-to-use logins, each with its email pre-confirmed:

| Role | Email | Password |
|---|---|---|
| Admin | `admin123@smartmappia.com` | `admin123` |
| User (passenger) | `***REMOVED***@smartmappia.com` | `***REMOVED***` |
| Driver (pre-approved) | `***REMOVED***@smartmappia.com` | `***REMOVED***` |

It's idempotent — re-running resets each account to its correct role and password, which is the
quickest way to fix a profile that got stuck on the wrong role. (`npm run seed:admin` still works
if you only want the admin.) Sign in at `/login` with any of them.

> These are **test credentials** — change them before production, and keep the admin email in
> sync with `ADMIN_EMAILS`.
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86

---

## Kick the tires

Health check (no auth needed):

```bash
curl http://localhost:4000/api/health
```

Public live tracking, once a booking exists (no auth needed):

```bash
curl http://localhost:4000/api/tracking/SM-7K3PQ9TM
```

Creating a booking now needs a signed-in user, so the easiest way to exercise the full flow
(sign up → book → pay → approve a driver → accept → track) is through the frontend app. If you
want to hit `POST /api/bookings` directly with curl, include a real Supabase access token:

```bash
curl -X POST http://localhost:4000/api/bookings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-supabase-access-token>" \
  -d '{
    "trip_type": "house_to_airport",
    "pickup_address": "Al Olaya, Riyadh",
    "dropoff_address": "King Khalid International Airport, Terminal 1",
    "pickup_datetime": "2026-06-20T08:00:00Z",
    "passenger_name": "Test Passenger",
    "passenger_whatsapp": "+9665XXXXXXXX"
  }'
```

You'll get back a `bookingCode` like `SM-7K3PQ9TM` and the path to the next step.

---

## Deploy to Vercel

Push this folder to a Git repo, import it in Vercel, and add the **same env vars** in the Vercel
dashboard (the platform provides env there — `dotenv` is a no-op). `vercel.json` already routes
every request to the Express app. The frontend deploys separately.

---

## Project structure

```
smart-mappia-backend/
├── api/index.js                  # Vercel entrypoint (exports the Express app)
├── controllers/
│   ├── authController.js          # profile sync + automatic-admin rule
│   ├── bookingsController.js      # create, summary, cancel
│   ├── paymentsController.js      # instructions + proof upload/record
│   ├── trackingController.js      # public timeline, ETAs, live driver position
│   ├── adminController.js         # bookings, verify/reject, assign + approve drivers
│   └── driverController.js        # available feed, accept, location, status updates
├── middleware/
│   └── auth.js                    # verify Supabase JWT -> role + driver approval
├── lib/
│   ├── supabase.js                # service-role client (server only)
│   ├── config.js                  # all env-driven config in one place
│   ├── fare.js                    # fare snapshot (SAR 100 base + 3.75% service fee = 103.75)
│   ├── storage.js                 # signed upload/download URLs for proofs
│   ├── tracking.js                # tracking_events helper
│   ├── payments.js                # verify/reject state machine (shared)
│   ├── ledger.js                  # commission/payout math + ledger write
│   ├── realtime.js                # Supabase Realtime broadcast helpers
│   └── geo.js                     # distance + ETA (nearest-driver matching)
├── routes/
│   ├── health.js  auth.js  bookings.js  tracking.js  admin.js  driver.js
├── app.js                         # Express app (middleware + routes)
├── server.js                      # local runner (app.listen)
├── vercel.json   package.json   .env.example
<<<<<<< HEAD
├── 0001_init_smart_mappia.sql     # base schema
└── 0002_auth_driver_approval.sql  # driver-approval flag
=======
└── migrations/
    ├── 0001_init_smart_mappia.sql            # base schema
    ├── 0002_auth_driver_approval.sql         # driver-approval flag
    ├── 0003_profile_registration_fields.sql  # sign-up extra fields
    └── utilities/profile-roles.sql           # inspect/fix a stuck role
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
```

---

## Where things stand

The core booking → pay → match → track → payout loop is all built, plus real auth (Supabase
JWT), the Grab-style driver self-accept, live tracking, and the driver-approval workflow.

Still on the wishlist:

- **Moyasar card payments** (`payment_method = 'moyasar'`) + webhook verification — the
  schema/enums are ready, the handlers aren't.
- **Atomic writes** — wrap the multi-table verify/complete steps in Postgres functions (RPCs).
- **Proof anti-reuse** — reject a re-used `file_hash` (the column exists and is indexed).
- **Automated tests** — it's syntax-checked and smoke-tested by hand for now.

See [DOCUMENTATION.md](DOCUMENTATION.md) for the full picture and the production go-live guide.
```
