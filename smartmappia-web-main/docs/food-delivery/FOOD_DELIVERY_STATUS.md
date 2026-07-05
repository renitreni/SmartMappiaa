# SmartMappia — Food Delivery: Build Status & Decision Log

**Last updated: 2026-07-04.** This is the single record of what was built, what was
decided (and why), and what is still open — so nobody has to reconstruct it from
chat logs or diffs. Companion specs live in this folder (`FOOD_DELIVERY_PRD.md`,
`FOOD_DELIVERY_ERD.md`, `FOOD_DELIVERY_BACKEND.md`, `FOOD_DELIVERY_FRONTEND.md`);
where this document and those disagree, THIS document reflects the current product
decisions.

---

## 1. Product decisions (agreed, current)

| Topic | Decision |
|---|---|
| Restaurant onboarding | **Admin-only.** Restaurants have NO accounts. They contact SmartMappia; an admin creates the restaurant and imports its menu, prices, and photos through the admin Food tab (full CRUD, nothing hardcoded). New restaurants start **Unlisted** and appear to customers only when the admin flips them to Listed. |
| Who runs restaurant operations | **Admins.** Accepting/rejecting orders and advancing Preparing → Ready happen in the admin Food tab. The self-service merchant portal that was initially built was **removed** per this decision (recoverable from history if restaurants ever get accounts). |
| Sign-in landing | Users land on the **multi-service hub `/home`** (choose Pick & Drop or Food Delivery), not directly in Pick & Drop. |
| Payment methods | **STC Pay** (manual proof, live), **Cash on delivery** (rider collects; marking delivered records the payment), **Card via Tap = placeholder** ("coming soon"). |
| Rider dispatch | **Grab-style cascade.** When a job is ready for a driver, the **nearest online approved driver** gets an **exclusive 30-second offer**. Decline or timeout passes it to the next-nearest. When all candidates pass, the job drops into the classic open feed (first come, first served). Applies to **both** food deliveries and Pick & Drop rides. |
| Double-claim safety | Three layers: only one pending offer per job (partial unique index), compare-and-swap on the offer row, compare-and-swap on the job itself. Two drivers can never win the same job. |
| Live tracking | The customer tracking page shows a live map: the rider pin **glides** on every GPS ping, plus restaurant and drop-off pins, rider name, ETA, **Call / WhatsApp** buttons, and notification-style step descriptions ("The restaurant is preparing your order", ...). |
| Photo proof (mandatory) | The rider MUST photograph the order **at the restaurant** before "on the way", and photograph the **handover** before "delivered" — the backend rejects the status change without the photo. Photos live in the private proofs bucket; admins view them via short-lived signed URLs ("View proof photos"). |
| Driver ratings | After a delivered food order or a completed Pick & Drop trip, the customer rates the driver **1-5 stars** (+ optional comment). One rating per job, server-enforced; stored in `driver_ratings` for both services. |
| Refunds | An admin can **cancel** any live order. If it was paid, the customer is told the refund takes a few hours up to 14 days (copy in the tracking page); after returning the money the admin clicks **Mark refunded**. |
| Idempotency store | In-memory is **accepted**: production runs one Docker container on a Hostinger VPS 2. If the backend is ever scaled to multiple instances/serverless, move the store to a DB table. (Payments are additionally DB-idempotent via the unique `gateway_transaction_id` index.) |
| Tap Payments | **Placeholder only.** Endpoints exist but answer 503 "not configured" while `TAP_*` env vars are unset; the UI shows "coming soon". STC Pay manual proof is the live payment path. Verify Tap's webhook signature in sandbox before ever setting the keys. |
| Menu photos | Plain `image_url` fields for now (admin pastes hosted URLs). A Supabase Storage `menu-images` bucket upload flow is a later upgrade. |

## 2. Hard business rules (server-enforced, verified)

All money math lives in `backend/lib/foodMoney.js` and is recomputed from DB menu
prices at checkout — client-sent totals are never read.

1. Cart subtotal **≥ 30 SAR** or checkout returns `422 { failure_reason: "min_order" }`.
2. Delivery fee flat **10 SAR** within **15 km** (haversine restaurant → customer);
   outside the radius checkout returns `422 { failure_reason: "outside_radius" }`.
3. Per-item platform margin: **5 SAR** meals/packages, **3 SAR** drinks/desserts/add-ons.
4. A restaurant at **credit_used ≥ 300 SAR** cannot have orders accepted (403);
   accepting charges the order margin to `merchant_credit_ledger` and `credit_used`.
5. **80% alert (240 SAR)** fires exactly once, on the charge that crosses it;
   reaching 300 auto-suspends the restaurant until an admin reconciles.
6. Only gateway tokens/transaction ids are stored — never card numbers/CVV/expiry.
7. Privileged actions and admin PII reads are written to the immutable `audit_logs`.

## 3. Database — migrations 0009–0013 (NOT yet applied)

Run in the Supabase SQL Editor **in order**; verify with `npm run check:migrations`.

| File | Contents |
|---|---|
| `0009_food_delivery_core.sql` | `merchant` role value; `merchant_status` + `item_type` enums; `merchants` (owner_id **nullable** — admin-run model; `is_active` defaults **false** = unlisted), `menu_categories`, `menu_items`; `gen_order_code()` (`FD-` prefix); indexes; RLS. |
| `0010_food_delivery_orders.sql` | `order_status`/`fd_payment_status`/`fd_payment_method` enums; `carts`, `cart_items`, `orders`, `order_items` (immutable snapshots), `order_payments` (unique `gateway_transaction_id` = webhook idempotency), `deliveries` (one per order — the rider leg); RLS. |
| `0011_food_delivery_credit.sql` | `credit_ledger_type` enum; append-only `merchant_credit_ledger`; RLS. |
| `0012_food_delivery_extras.sql` | `ratings`, `promocodes`, `fd_analytics_events` (PRD §9 events), `audit_logs` (append-only); RLS. |
| `0013_dispatch_and_merchant_vetting.sql` | `dispatch_offers` (the 30s offer cascade; one pending offer per job); merchants default unlisted + owner_id nullable (idempotent re-assertions). |
| `0014_driver_ratings.sql` | `driver_ratings` — 1-5 stars per delivered food order / completed P&D trip (one per job, both services). |

Note: `0010` also carries the later additions — the `cash` value on
`fd_payment_method` and the `pickup_photo_path` / `delivery_photo_path` /
`picked_up_at` columns on `deliveries` (photo-proof + cash-on-delivery).

Dormant-by-design schema: `merchants.owner_id`, the `merchant` role value, and the
owner-based RLS clauses stay in the schema unused — they are the re-entry point if
restaurants ever get their own portal accounts.

## 4. Backend — what exists

New modules: `lib/foodMoney.js` (single money source of truth), `lib/dispatch.js`
(offer cascade + sweeper), `lib/audit.js`, `lib/foodEvents.js`, `lib/validate.js`
(per-route schemas, unknown fields rejected), `middleware/foodAuth.js`
(`optionalAuth`), `middleware/idempotency.js` (`Idempotency-Key` replay). Extended:
`lib/config.js` (food/dispatch/tap sections), `lib/realtime.js` (food channels),
`middleware/rateLimiters.js` (search/checkout/pay/driver/events limiters).

The dispatch sweeper starts from `server.js` (long-running VPS process). It expires
stale offers every 5s and cascades; state is in the DB so restarts resume cleanly.

### Endpoints

Customer (`routes/food.js`):
- `GET /api/food/restaurants` (public; `?q=`, `?cuisine=`) · `GET /api/food/restaurants/:id`
- `GET/POST/PATCH/DELETE /api/food/cart...` (server reads all prices)
- `POST /api/food/orders` (checkout — 30 SAR + radius enforced; idempotent)
- `GET /api/food/orders` · `GET /api/food/orders/:code` (tracking incl. rider name,
  contact, last GPS fix, ETA)
- `GET/POST /api/food/orders/:code/pay...` (STC proof via signed URL to the private
  `payment-proofs` bucket) · `POST .../tap-charge` (503 placeholder) ·
  `POST /api/food/webhooks/tap` (signed, idempotent)
- `POST /api/food/events` (whitelisted client analytics)

Driver (`routes/driver.js`, additions):
- `GET /api/driver/offers` · `POST /api/driver/offers/:id/accept|decline`
- `GET /api/driver/deliveries` (mine) · `GET /api/driver/deliveries/available` (open pool)
- `POST /api/driver/deliveries/:code/claim` · `POST /api/driver/deliveries/:code/status`
  (`picked_up` → order `out_for_delivery`; `delivered` → order `delivered`)
- GPS pings (`POST /api/driver/location`, every ~12s while online) now also push the
  rider pin + ETA to `fd-order-<code>` for food deliveries.

Admin (`routes/admin.js` → `/api/admin/food/...`):
- Restaurants: `GET/POST /merchants`, `PATCH/DELETE /merchants/:id` (PATCH includes
  `is_active` listing), `suspend`, `reactivate`, `credit` (reconcile/replenish)
- Menus: `GET /merchants/:id/menu`, `POST /merchants/:id/menu/categories`,
  `PATCH/DELETE /categories/:id`, `POST /merchants/:id/menu/items`,
  `PATCH/DELETE /items/:id`
- Orders: `GET /orders`, `accept` (credit-gated), `reject`, `PATCH .../status`,
  `verify-payment`, `reject-payment`, `assign-driver` (manual rider fallback),
  `cancel`, `refund`
- `GET /overview` (volume, margin revenue, suspended count, payments to verify)

### Realtime channels
`fd-order-<code>` (customer tracking: status, payment, rider + live location),
`driver-<driverId>` (exclusive offers), `drivers-available` (open pool: rides +
`new_delivery`/`delivery_taken`), `admin-food` (admin refresh pings),
`merchant-<merchantId>` (currently no subscriber — kept for a future restaurant portal).

## 5. Frontend — what exists

Customer (`src/portal/food/`): `/food` discovery (search, cuisine chips, skeletons,
empty/error states) → `/food/r/:id` menu (category tabs, unavailable states, sticky
cart bar) → `/food/cart` (steppers + the 30 SAR gate with shortfall message and a
disabled checkout) → `/food/checkout` (address + device location for the radius rule,
summary, STC pay + proof upload, Tap "coming soon") → `/food/track/:code` (live
stepper, live map with gliding rider pin, rider card with Call/WhatsApp + ETA,
inline payment panel, refund messaging) → `/food/orders` history.

Driver (`src/portal/driver/DriverDispatch.jsx`, mounted in DriverPage): exclusive
offer card with a live 30s countdown and Accept/Pass, My deliveries (customer
contact, Picked up → Delivered), and the open-deliveries pool. Offers arrive via
the `driver-<id>` channel instantly, with 5s polling as fallback.

Admin (`src/portal/admin/FoodAdmin.jsx`, "Food" tab): overview stats; restaurant
CRUD (add/edit/list-unlist/delete) with credit bars, reconcile, suspend/reactivate;
full menu editor (categories + items with price/type/photo/availability); order
operations (accept with credit gate, reject, status ladder, verify/reject payment,
assign/change rider, cancel, mark refunded) with a "Needs action" filter.

Removed: the merchant portal (`/merchant`), merchant signup option, and
`/api/merchant/*` routes — per the admin-only decision (see §1).

## 6. How an order flows (end to end)

1. After sign-in the user lands on `/home` and picks Food Delivery. They browse
   `/food` (only Listed restaurants), build a cart, choose a payment method
   (STC Pay / cash on delivery / card "coming soon"), and check out — the server
   recomputes money, enforces 30 SAR + 15 km, creates `FD-XXXXXXXX`.
2. STC Pay: customer uploads the transfer proof; admin verifies it in the Food tab
   (test mode auto-verifies). Cash: nothing to pay online — straight to tracking
   with a "have SAR X ready" reminder.
3. Admin accepts the order on the restaurant's behalf — the platform margin is
   charged to the restaurant's 300 SAR credit (80% alert at 240; block + suspend at
   300). The customer's stepper reads "The restaurant is preparing your order".
4. Once accepted AND (paid or cash), dispatch offers the delivery to the nearest
   online driver for 30s, cascading on decline/timeout; exhausted → open pool
   (+ manual admin assignment as fallback).
5. The rider accepts and drives to the restaurant. They MUST photograph the order
   there before tapping "on the way" (order → out_for_delivery), and photograph the
   handover before "delivered". A cash order records the collected payment on
   delivery. The customer watches the pin move live and can call/WhatsApp the rider.
6. After delivery the customer rates the rider 1-5 stars (same widget rates P&D
   drivers after completed trips).
7. If anything goes wrong, admin cancels; paid orders show the refund-pending
   message until admin marks the refund done.

## 7. Runbook

- Apply migrations 0009–0013 (Supabase SQL Editor), then `npm run check:migrations`.
- Backend must run as the long-lived server (`npm start` / Docker on the Hostinger
  VPS) for the dispatch sweeper; `node -e "require('dotenv').config(); require('./app')"`
  verifies it loads.
- Frontend: `npm run build` (passing as of this writing).
- Env: see `.env.example` — food/dispatch knobs are optional overrides; leave
  `TAP_*` unset (placeholder); set `AUTO_VERIFY_STCPAY_TEST_MODE=false` in production.

## 8. Open items (not yet built)

1. Menu photo uploads to Supabase Storage (currently pasted URLs).
2. Ratings UI + promocode application at checkout (tables exist from 0012).
3. Native push delivery (FCM) — notification_events are logged, delivery pending the APK.
4. Tap Payments real integration (placeholder; sandbox-verify the webhook first).
5. Driver earnings for food deliveries (Pick & Drop writes `ledger_entries`; food
   rider payout math is not defined yet — needs a product decision).
6. Homepage "Restaurants" marketing section does not yet link to `/food`.
7. DB-backed idempotency keys — only needed if the backend ever runs more than one
   instance.
