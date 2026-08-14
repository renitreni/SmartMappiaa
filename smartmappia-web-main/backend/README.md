# Smart Mappia — Backend

The API for Smart Mappia, a multi-service logistics platform for Saudi Arabia running three service
lines from one codebase and one driver fleet:

- **Pick & Drop** — scheduled airport transfers
- **Food Delivery** — restaurant ordering and delivery within a 15 km radius
- **Ecommerce** — partner stores selling physical goods, with stock and product variants
  (feature-flagged off by default via `SHOP_ENABLED`)

**Node.js + Express** (plain JavaScript, CommonJS, no build step) on **Supabase** (Postgres 15, Auth,
Storage, Realtime). Runs identically on a laptop and on the production VPS under PM2.

**Live:** `https://api.smartmappia.com` (Nginx + HTTPS, PM2 process `smartmappia-api`, Cloudflare in
front).

> Detailed engineering documentation is kept private and is **not** in this repository. If you have
> the working copy, see `docs/engineering/` — a 20-part handbook covering architecture, the data
> model, the dispatch engine, the money model, security, and operations. This README is intentionally
> self-contained so it stands alone without it.

---

## Architecture in brief

```
Client (React SPA / Android WebView)
  |
  v  Bearer JWT
Nginx  ->  Express (PM2, port 4000)
             |
   routes/ -> controllers/ -> lib/  ->  Supabase Postgres
                                         Auth, Storage, Realtime
```

Three layers, strictly one-directional:

| Layer | Responsibility | Must not |
|---|---|---|
| `routes/` | Paths, guards, rate limiters, validation schemas | Contain business logic |
| `controllers/` | Parse the request, call `lib/`, shape the response | Query the database directly |
| `lib/` | **All** business logic and database access | Reference `req` or `res` |

**There is no `services/` directory — `lib/` is the service layer.** It is substantial:
`lib/dispatch.js` alone is 551 lines and holds the platform's most concurrency-sensitive code.

Key invariants:

- **All money is computed server-side** from database values. Client-sent amounts are ignored.
- **The database arbitrates concurrency** — partial unique indexes and compare-and-swap updates, not
  application locks.
- **Realtime accelerates; polling guarantees.** Every broadcast failure is swallowed by design.
- **`lib/config.js` is the only place that reads `process.env`.**

---

## Endpoints

Twelve route modules mounted in `app.js`.

**Auth** — `/api/auth`
- `POST /signup` — create an account. `role` accepts only `passenger` or `driver`; an email listed in
  `ADMIN_EMAILS` is refused (`403`) to block register-then-auto-promote.
- `POST /sync` — upsert the profile and resolve the role. A client-supplied role is never honoured.
- `PATCH /profile` · `POST /avatar/signed-url`

**Bookings (Pick & Drop)** — `/api/bookings`
- `POST /` · `GET /` — create, own history
- `GET /:code` — summary (public, code-gated) · `POST /:code/cancel`
- `PATCH /:code/contact` · `POST /:code/rate-driver`
- `GET /:code/payment-instructions` — STC Pay details and fare
- `POST /:code/payment-proof/signed-url` · `POST /:code/payment-proof`

**Tracking** — `GET /api/tracking/:code` (public, code-gated)

**Driver** — `/api/driver`
- Feed and rides: `GET /available` · `POST /rides/:code/accept` · `GET /rides` ·
  `POST /rides/:code/status` · `POST /rides/:code/cancel`
- Dispatch offers: `GET /offers` · `POST /offers/:id/accept` · `/decline`
- Deliveries: `GET /deliveries` · `/deliveries/available` · `POST /deliveries/:code/claim` ·
  `/cancel` · `/photo-url` · `/status`
- `POST /location` · `PATCH /services` · `GET /cash`
- KYC: `POST /documents/signed-url` · `POST /documents` · `GET /documents`

**Merchant** — `/api/merchant` (entire router behind `requireMerchant`)
- `GET|PATCH /profile` · logo and menu-image upload
- `GET /analytics` · `GET /menu` · categories and items CRUD
- Orders: `GET /orders` · `POST /orders/:code/accept` · `/reject` ·
  `PATCH /orders/:code/status` — **authority caps at `ready`**

**Food** — `/api/food`
- Discovery: `GET /restaurants` · `/restaurants/:id` (public)
- Cart: `GET|POST|PATCH|DELETE /cart[...]`
- `POST /orders` — checkout. Re-reads menu prices, recomputes distance, enforces the SAR 30 minimum
  and 15 km radius. Accepts `Idempotency-Key`.
- `GET /orders` · `/orders/:code` · `PATCH /orders/:code/contact` · `POST /orders/:code/rate-driver`
- Payments: `GET|POST /orders/:code/pay[...]` (STC Pay proof) · `POST /orders/:code/charge` (card)
- Card payments platform-wide: `/api/payment-methods` (saved cards) and `/api/payments`
  (ride charge + the single Tap webhook). Both 503 until `TAP_SECRET_KEY` is set.
- `POST /webhooks/tap` (signed) · `POST /events`

**Admin** — `/api/admin` (entire router behind `requireAdmin`)
- Rides: `GET /stats` · `/reports` · `/bookings[/:code]` ·
  `POST /bookings/:code/verify-payment` — **this triggers ride dispatch** · `/reject-payment` ·
  `/assign-driver`
- Drivers: `GET /drivers` · `POST /drivers/:id/approval` · `GET /drivers/cash` ·
  `POST /drivers/:id/settle-cash` · KYC review endpoints
- Food: `GET /food/overview` · `GET /food/settlement` (payout-versus-markup CSV) · merchants CRUD,
  suspend, reactivate, credit, owner provisioning · menu CRUD · full order control

**Notifications** — `/api/notifications` — `GET /push-config` · `POST /register` · `/unregister` ·
`GET /` · `PATCH /read`

**Maps proxies** (public, rate-limited, 60-second LRU cache)
- `GET /api/route` — Google Routes API
- `GET /api/locations/search` · `/details` · `/reverse` · `/nearby` — Places and Geocoding

The browser never holds a key with server privileges — `GOOGLE_MAPS_SERVER_KEY` stays here.

**Health** — `GET /api/health` — liveness plus a database ping.

---

**Ecommerce (shop)** — `/api/shop`, `/api/merchant/shop`, `/api/admin/shop`

Mirrors the food surface endpoint for endpoint. 69 endpoints in total: 17 customer, 20 store owner,
32 admin. `/api/shop` and `/api/merchant/shop` return `503` unless `SHOP_ENABLED=true`.

- `GET /api/shop/stores` · `GET /api/shop/stores/:id` — discovery and catalogue (public)
- cart CRUD · `POST /api/shop/orders` — checkout (idempotent; server recomputes all money)
- `/api/merchant/shop/*` — the store owner's portal: catalogue, variants, stock, order queue
- `/api/admin/shop/*` — stores, catalogue, orders, inventory, settlement

Two things worth knowing about this vertical:

**Checkout is a single Postgres transaction.** It writes four tables while decrementing stock, so it
runs inside the `shop_place_order` RPC rather than as a sequence of statements. The stock check rides
on the `UPDATE` predicate itself, so two concurrent checkouts for the last unit cannot both succeed.
Money is still computed in JavaScript (`lib/shopMoney.js`); the RPC only provides atomicity.

**Stock counts are not public.** Exact real-time inventory is sales velocity — polled over time it
reveals how many units of every SKU a store sells per day. The customer API returns a banded
`in_stock` / `low` / `out`, and the underlying columns are revoked from the public database roles.

## Auth and roles

Supabase Auth, email and password. **JWT bearer tokens only — no cookies, no sessions, no CSRF
surface.** The frontend sends `Authorization: Bearer <jwt>`; `middleware/auth.js` verifies it and
reads the role from `profiles`.

| Guard | Requires |
|---|---|
| `requireToken` | Valid JWT; profile may not exist |
| `requireAuth` | Valid JWT **and** a `profiles` row |
| `requireAdmin` | `role = admin` |
| `requireDriver` | driver or admin |
| `requireMerchant` | merchant or admin |
| `requireApprovedDriver` | driver + `driver_approved` (admin bypasses) |
| `optionalAuth` | Attaches identity if present; never rejects |

- **Passengers** must be signed in to book.
- **Drivers** sign up but stay unapproved until six KYC documents are verified. Verifying the last
  one auto-approves. Only then can they see the feed or accept work.
- **Merchants** cannot self-register. An admin provisions the owner via
  `POST /api/admin/food/merchants/:id/owner`.
- **Admins** are granted solely by the `ADMIN_EMAILS` allow-list, never from a request body.
- **Admin passes the driver and merchant guards** — an admin account is a superset of every role.

Row Level Security is enabled on all 38 tables. The backend uses the `service_role` key and bypasses
it; RLS defends the path where a client uses the anon key directly.

---

## Get it running (local)

1. **Database** — in the Supabase SQL Editor run `backend/migrations/0001`–`0024` in order,
   **skipping `0004`**.

   > `0004_auto_approve_drivers.PILOT.sql` removes the KYC gate from every driver. Pilot demos only.
   > **Never run it in production.**

2. **Storage** — create four buckets:

   | Bucket | Visibility |
   |---|---|
   | `payment-proofs` | **Private** |
   | `driver-docs` | **Private** |
   | `merchant-images` | Public |
   | `avatars` | Public (created lazily by the backend if absent) |

3. **Env** — `cp .env.example .env`, then fill at minimum `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`, `SMART_MAPPIA_STCPAY_NUMBER`,
   `GOOGLE_MAPS_SERVER_KEY`.

   Keep `AUTO_VERIFY_STCPAY_TEST_MODE=true` locally so payments self-verify.
   **It must be `false` in production.**

4. **Run** — `npm install && npm run dev` -> `http://localhost:4000`

5. **Accounts** — `npm run seed:accounts` (admin + test passenger + test driver).

   > Never run `npm run seed:admins` against production once the named admins exist — it resets them
   > to fresh random passwords.

6. **Verify** — `npm run check:migrations` and `curl http://localhost:4000/api/health`.

   > The checker probes `0001`-`0003`, `0009`-`0016`, `0021`-`0024`. It does **not** probe
   > `0017`-`0020` — verify `0019` manually, since it carries the margin confidentiality grants.

---

## Production

Deployed on a **Hostinger VPS**: Node under PM2 behind Nginx and Certbot, with Cloudflare in front.
`app.set('trust proxy', 1)` is on so rate limits key on the real client IP.

Redeploy:

```bash
cd /opt/SmartMappiaa && git pull && \
cd smartmappia-web-main/backend && npm install --omit=dev && pm2 restart smartmappia-api && \
cd ../frontend && npm install && npm run build
```

Restarts are safe — all dispatch state lives in Postgres, so the sweepers resume cleanly.

After deploying, check the boot log:

```bash
pm2 logs smartmappia-api --lines 50
```

| Line | Meaning |
|---|---|
| `Dispatch sweeper running (...)` | Healthy. **Its absence means dispatch has no cascade.** |
| `[cors] CORS_ORIGINS is not set` | **Every browser origin is allowed.** Fix immediately. |
| `[SECURITY] AUTO_VERIFY_STCPAY_TEST_MODE` | **Payments are auto-verifying.** Fix immediately. |

---

## Security notes

- **Rate limiting** — global 240/min plus 20/min on auth, and 15 per-endpoint limiters in
  `middleware/rateLimiters.js`. When debugging a `429`, check these first.
- **Validation** — `lib/validate.js` whitelists request bodies, **rejects** unknown fields, and
  replaces `req.body` with only validated fields, so mass assignment is structurally impossible.
- **Geofencing** — driver status transitions asserting physical presence are gated on a fresh GPS fix
  and **fail closed**.
- **RLS** on every table; the `service_role` key bypasses it — keep it server-only, **never** under a
  `VITE_` name.
- **Column-level grants** (migration `0019`) hide `net_price`, `platform_margin_total`, and
  `margin_*` from client roles. Any migration touching `menu_items`, `orders`, or `order_items` must
  extend that grant list.
- `.env` is gitignored. Never commit secrets.

Before launch: set `CORS_ORIGINS`, set `AUTO_VERIFY_STCPAY_TEST_MODE=false`, remove test accounts,
and rotate seed passwords.

---

### Grants filter reads. They also have to filter writes.

Supabase grants table-wide `INSERT/UPDATE/DELETE` on every public-schema table to the `anon` and
`authenticated` roles by default, leaving Row Level Security as the only barrier. Wherever a policy
was broader than the columns it was meant to protect, the gap was total — a policy of
`using (id = auth.uid())` on `profiles` let **any signed-in user set their own `role` to `admin`**
straight through PostgREST, with nothing but the public key.

Migrations `0030` and `0032` revoke those write grants and give back only the columns each party
legitimately edits. `npm run check:migrations` verifies both directions: that the client roles have
lost the dangerous grants, and that a user can still edit their own name.

Two classes of check exist because the service role cannot detect either problem — it holds every
privilege and sees every column:

| Check | Client | Catches |
|---|---|---|
| Grant | anon key | a confidential column becoming readable |
| Privilege | `check_column_privilege` RPC | a client role regaining `UPDATE` |

Set `SUPABASE_ANON_KEY` in `.env` (it is public by design — it already ships in the frontend bundle)
or these report `[SKIP]`, which is not a pass.

## Project structure

```
backend/
├── app.js            Express app: middleware + route mounts (exported, never listens)
├── server.js         The entry point: dotenv, app.listen, startDispatchSweeper()
├── routes/           health, auth, bookings, tracking, admin, driver, merchant,
│                     notifications, route, food, locations
├── controllers/      13 modules + food/ (admin, orders, merchant, ratings, dispatch, docs)
├── middleware/       auth.js (6 guards), foodAuth.js (optionalAuth),
│                     rateLimiters.js (15 limiters), idempotency.js
├── lib/              THE SERVICE LAYER (24 files):
│                       dispatch, foodMoney, fare, ledger, driverCash, payments,
│                       foodOrderActions, geofence, geo, realtime, notifications,
│                       webPush, storage, uploadValidation, validate, audit,
│                       config, supabase, ...
├── migrations/       0001..0024 (skip 0004 in production) + utilities/
└── scripts/          seed-admin, seed-admins, seed-user, seed-driver,
                      check-migrations, demo/
```

---

## Web Push

1. Apply migration `0017`.
2. `npx web-push generate-vapid-keys`
3. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, then redeploy both projects.
4. Serve the frontend over HTTPS. iOS requires adding the site to the Home Screen.

Dead subscriptions (404/410) are pruned automatically. The notification inbox row is the durable
record; push and realtime are best-effort.

---

## Known gaps

- **No automated tests.** The highest-value first step is unit tests for the pure modules
  (`foodMoney.js`, `ledger.js`, `fare.js`, `validate.js`, `geo.js`) — no database required.
- **No transactions.** The Supabase client exposes none, so multi-table writes are sequential.
  Moving them into Postgres functions (RPCs) is the main outstanding integrity improvement.
- **No monitoring or alerting.** An external uptime check on `/api/health` is the cheapest fix.
- `GET /:code/payment-instructions` has no rate limiter, unlike its siblings.
- `merchantOrderLimiter` is defined but not wired into `routes/merchant.js`.
- `ADMIN_API_KEY` / `DRIVER_API_KEY` are legacy and used by no route.
- `vercel.json` and `api/index.js` are **dead** — hosting is the Hostinger VPS only.
- **Tap Payments** — schema, enums, and the webhook path exist; the flow is behind a flag and off.
