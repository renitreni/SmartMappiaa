# Smart Mappia — Backend

This is the backend for Smart Mappia's Airport **Pick & Drop**. It handles booking a ride, paying by
STC Pay, matching a nearby driver Grab-style, tracking the trip live, driver verification (KYC), and
notification plumbing.

**Node.js + Express** (plain JavaScript, no build step) on **Supabase** (Postgres + Auth + private
Storage + Realtime). Runs the same on your laptop (`server.js`) and on the production VPS via PM2.

> Quick start below. **Full platform reference (architecture, data model, deployment, security,
> admin runbook):** [../docs/SMARTMAPPIA.md](../docs/SMARTMAPPIA.md). **Food Delivery deep-dive:**
> [../docs/food-delivery/FOOD_DELIVERY.md](../docs/food-delivery/FOOD_DELIVERY.md). Older docs
> (the previous backend guide, deployment log, etc.) are archived under
> [../docs/archive/](../docs/archive/).

**Live:** API at `https://api.smartmappia.com` (behind Nginx + HTTPS, PM2 process `smartmappia-api`).

---

## What's built

**Auth** (Supabase JWT)
- `POST /api/auth/signup` — create the account (email pre-confirmed)
- `POST /api/auth/sync` — after login, upsert the profile + role (admin only via `ADMIN_EMAILS`)

**Passenger / booking**
- `POST /api/bookings` — create (requires sign-in; fare snapshot + booking code)
- `GET  /api/bookings/:code` — booking summary · `POST /api/bookings/:code/cancel` — owner cancels
- `GET  /api/bookings/:code/payment-instructions` — STC Pay details + fare
- `POST /api/bookings/:code/payment-proof/signed-url` + `POST /api/bookings/:code/payment-proof`
- `GET  /api/tracking/:code` — public live tracking (timeline, ETAs, driver position)

**Driver**
- `GET  /api/driver/available` · `POST /api/driver/rides/:code/accept` · `POST /api/driver/location`
- `GET  /api/driver/rides` · `POST /api/driver/rides/:code/status`
- **KYC:** `POST /api/driver/documents/signed-url` · `POST /api/driver/documents` · `GET /api/driver/documents`

**Admin** (`requireAdmin`)
- `GET /api/admin/stats` · `/reports` · `/bookings` · `/bookings/:code`
- `POST /api/admin/bookings/:code/verify-payment` · `/reject-payment` · `/assign-driver`
- `GET /api/admin/drivers` · `POST /api/admin/drivers/:id/approval`
- **KYC review:** `GET /api/admin/drivers/:id/documents` · `POST /api/admin/drivers/:id/documents/:docId/review`

**Notifications**
- `POST /api/notifications/register` · `/unregister` · `GET /api/notifications` (device push tokens + log)

**Routing (OSRM proxy)**
- `GET /api/osrm/route/v1/driving/...` — proxies the private self-hosted OSRM (localhost:5000)

### How auth works
Supabase Auth (email + password). The frontend sends `Authorization: Bearer <jwt>`; the backend
verifies it and reads the role from `profiles`.
- **Passengers** must be signed in to book.
- **Drivers** sign up but stay unapproved until they pass **document verification** (KYC) and an
  admin approves — only then can they see the feed or accept rides.
- **Admins** aren't a signup option; role is granted only to emails in `ADMIN_EMAILS` (or an
  existing admin profile). Never self-elevated via the request body.
- An **admin also passes the driver guards** (admin "View as" preview convenience).

---

## Get it running (local)

1. **Database** — in Supabase SQL Editor run migrations in order:
   `0001, 0002, 0003, 0005, 0006, 0007, 0008` (**skip `0004`** — pilot-only auto-approve).
2. **Storage** — create two **private** buckets: `payment-proofs` and `driver-docs`,
   and one **public** bucket: `merchant-images` (restaurant logos + menu photos).
3. **Env** — `cp .env.example .env`, then fill `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ADMIN_EMAILS`, `SMART_MAPPIA_STCPAY_NUMBER`. Keep `AUTO_VERIFY_STCPAY_TEST_MODE=true` for local
   testing; **`false` in production**.
4. **Run** — `npm install && npm run dev` → `http://localhost:4000`.
5. **Accounts** — `npm run seed:admin` (or `seed:accounts` for admin + user123 + driver123);
   `npm run seed:admins` creates the named admins (Ruth, Nawaf) with generated passwords.
   For custom admins: `ADMIN_SEED_EMAIL=you@x.com ADMIN_SEED_PASSWORD=... npm run seed:admin`.

Health check: `curl http://localhost:4000/api/health`.

---

## Production (VPS)

Deployed on a Hostinger VPS: Node + PM2 behind Nginx + Certbot (HTTPS), with self-hosted OSRM in
Docker. `app.set('trust proxy', 1)` is on so rate limits key on the real client IP. Full runbook +
exact commands: **[../docs/SMARTMAPPIA.md §16](../docs/SMARTMAPPIA.md#16-deployment--hosting--production)**
(archived original: [../docs/archive/production/DEPLOYMENT_LOG.md](../docs/archive/production/DEPLOYMENT_LOG.md)).

Redeploy after a change:
```bash
cd /opt/SmartMappiaa && git pull
cd smartmappia-web-main/backend && npm install --omit=dev && pm2 restart smartmappia-api
```

---

## Security notes
- Per-endpoint **rate limiting** (`middleware/rateLimiters.js`) on top of a global cap.
- **RLS** enabled on every table; the backend uses the `service_role` key (bypasses RLS) — keep it
  server-only, never in `VITE_*`.
- `.env` is gitignored; never commit secrets.
- Before public launch: turn off `AUTO_VERIFY_STCPAY_TEST_MODE`, remove test accounts, rotate seed
  passwords. See [../docs/SMARTMAPPIA.md §17](../docs/SMARTMAPPIA.md#17-security) (archived
  checklist: [../docs/archive/production/LAUNCH_CHECKLIST.md](../docs/archive/production/LAUNCH_CHECKLIST.md)).

---

## Project structure
```
backend/
├── controllers/  authController, bookingsController, paymentsController, trackingController,
│                 adminController, driverController, driverDocsController, notificationsController
├── middleware/   auth.js (JWT->role), rateLimiters.js
├── lib/          supabase, config, fare, storage, tracking, payments, ledger, realtime, geo, notifications
├── routes/       health, auth, bookings, tracking, admin, driver, merchant, locations, notifications, osrm
├── app.js        server.js   vercel.json   package.json   .env.example
└── migrations/   0001..0016 (+ 0004 PILOT — do not run in prod; 0009..0016 = Food Delivery)
```

---

## Still on the wishlist
- **Tap Payments** backend (create-charge + webhook) — schema/enums ready (0006), handlers not built.
- **Native push send** — token collection is built; the FCM sender worker is not.
- **Atomic writes** — wrap multi-table verify/complete in Postgres RPCs.
- **Automated tests** — syntax-checked + smoke-tested by hand for now.
