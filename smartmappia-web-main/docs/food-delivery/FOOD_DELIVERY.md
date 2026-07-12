# Smart Mappia — Food Delivery (Complete Documentation)

The single, self-contained reference for the Smart Mappia **Food Delivery** service: product
scope, business rules, roles & onboarding, every screen, the end-to-end order flow, dispatch and
re-dispatch, payments, the pricing/credit→payout model, the database schema and migrations, the
API, image uploads, the tracking UI, the operations runbook, and the QA plan.

Food Delivery is a second service on the existing Smart Mappia platform — **same Supabase project,
same auth, same STC Pay / Tap approach, same Grab-style dispatch** as Pick & Drop. For platform-wide
topics (architecture, hosting, security, env) see the master [SMARTMAPPIA.md](../SMARTMAPPIA.md).
Historical food docs (PRD, ERD, BACKEND, FRONTEND, HANDBOOK, STATUS, PRICING, DATABASE_AUDIT,
PROMPTS) are preserved under [../archive/food-delivery/](../archive/food-delivery/).

- **Last updated:** 2026-07-11
- **Audiences:** Customer, Merchant (restaurant), Admin, Rider (driver).

---

## Table of contents

1. [Product scope & MVP matrix](#1-product-scope--mvp-matrix)
2. [Hard business rules (server-enforced)](#2-hard-business-rules-server-enforced)
3. [Roles & onboarding](#3-roles--onboarding)
4. [Screens (customer / merchant / admin)](#4-screens-customer--merchant--admin)
5. [End-to-end order flow](#5-end-to-end-order-flow)
6. [Dispatch & auto re-dispatch](#6-dispatch--auto-re-dispatch)
7. [Payments](#7-payments)
8. [Pricing: current credit model & approved payout-ledger model](#8-pricing-current-credit-model--approved-payout-ledger-model)
9. [Database: schema, enums & migrations](#9-database-schema-enums--migrations)
10. [API reference](#10-api-reference)
11. [Restaurant & menu images (public bucket)](#11-restaurant--menu-images-public-bucket)
12. [Owner accounts](#12-owner-accounts)
13. [Tracking UI](#13-tracking-ui)
14. [Analytics events](#14-analytics-events)
15. [Operations runbook](#15-operations-runbook)
16. [QA plan](#16-qa-plan)

---

## 1. Product scope & MVP matrix

Three audiences on one platform: **Customer** (order food), **Merchant** (restaurant operations),
**Admin** (oversight + catalog). MVP priority:

| Feature | Priority | Logic / dependency |
|---|---|---|
| User authentication | Must | Login before any order |
| Restaurant / menu catalog | Must | Active menus, prices, categories |
| Search & filtering | Must | By restaurant name or cuisine |
| Cart & checkout | Must | Enforce **30 SAR minimum** (server-side) |
| Secure payment (STC / cash / Tap) | Must | STC Pay live; cash live; Tap deferred |
| Merchant / admin order dashboard | Must | Accept/reject in real time |
| Order status tracking | Must | Pending → Preparing → Ready → Out for delivery → Delivered |
| Delivery fee | Must | Flat **10 SAR** / 15 km (3-month promo) |
| Order history | Should | Re-order / support |
| Push notifications | Should | Status updates |
| Rating & reviews | Could | Food/rider feedback (rider rating is built) |
| Promocodes / discounts | Could | Not built |
| Advanced analytics | Won't (Phase 2) | Predictive modeling |

Non-functional targets: page load < 3 s, fully responsive, concurrent sessions without latency
degradation, PCI-DSS + SDAIA compliance (see [SMARTMAPPIA.md §17](../SMARTMAPPIA.md#17-security)).

---

## 2. Hard business rules (server-enforced)

All money math is recomputed from DB rows at checkout in
[`backend/lib/foodMoney.js`](../../backend/lib/foodMoney.js) — **client-sent totals are never
trusted**. Enforced server-side:

1. Cart **food subtotal ≥ 30 SAR** before payment — else checkout returns `422 { failure_reason:
   "min_order" }`.
2. Flat **10 SAR delivery fee** within **15 km** (haversine restaurant→customer) — outside the
   radius → `422 { failure_reason: "outside_radius" }`.
3. Per-item platform margin: **5 SAR** meals/packages, **3 SAR** drinks/desserts/add-ons
   (`config.food.margins`).
4. Merchant **300 SAR credit limit**: a restaurant at `credit_used ≥ 300` cannot have orders
   accepted (403).
5. **80% alert (240 SAR)** fires exactly once, on the charge that crosses it; reaching 300
   auto-suspends the restaurant until an admin reconciles.
6. Payments via STC Pay / cash (Tap later); only tokens/transaction ids stored — never raw card
   data. Privileged actions + admin PII reads go to the immutable `audit_logs`.

---

## 3. Roles & onboarding

**Restaurant onboarding is ADMIN-DRIVEN — restaurants cannot self-register.** They contact Smart
Mappia; an admin creates the restaurant, imports its menu/prices/photos, optionally links an owner
account, and lists it. Rationale: legality + a structured, vetted process (avoids a flood of
unvetted signups). Migration `0013` made new restaurants start **Unlisted** (`is_active = false`)
and `merchants.owner_id` nullable.

| Role | How obtained | In food delivery |
|---|---|---|
| **Customer** | Self-signup (`passenger`) | Browse, cart, checkout, pay, track, rate rider |
| **Rider (driver)** | Self-signup + KYC + admin approval | Receives delivery offers, picks up (photo), delivers (photo), collects cash |
| **Merchant (owner)** | **Admin-linked** at contract signing | Owner account (merchant role); receives owner notifications; future merchant portal |
| **Admin** | `ADMIN_EMAILS` allow-list | Runs restaurants, menus, orders, payments, credit, dispatch overrides |

The `merchant` role is **not** self-selectable (`authController.js` `SELF_ROLES`); it is granted
only via `POST /api/admin/food/merchants/:id/owner` (see [§12](#12-owner-accounts)).

---

## 4. Screens (customer / merchant / admin)

**Customer** ([`portal/food/`](../../frontend/src/portal/food/)): Home/discovery (featured +
search + cuisine chips), Restaurant menu (`RestaurantPage`), Cart (`FoodCartPage`), Checkout
(`FoodCheckoutPage`, shows the 422 failure reasons), Payment (`PaymentPanel`), Orders list
(`FoodOrdersPage`), live Track (`FoodTrackPage`).

**Merchant** ([`portal/merchant/`](../../frontend/src/portal/merchant/)): `MerchantDashboard` +
`MerchantLayout` — owner-scoped view (queries by `merchants.owner_id`). Note operations are
primarily admin-run today; a full merchant-facing login destination is a roadmap item.

**Admin** ([`portal/admin/FoodAdmin.jsx`](../../frontend/src/portal/admin/FoodAdmin.jsx)):
restaurant CRUD (create/edit/list-unlist/delete), **image uploads** (logo + menu photos),
**Assign owner**, menu import (categories + items), order operations (accept — 300 SAR
credit-gated / reject / advance), STC payment verify/reject, rider assignment (manual fallback),
credit reconcile, suspend/reactivate, and overview stats.

---

## 5. End-to-end order flow

```
Browse            GET  /api/food/restaurants            (active + listed only)
Open menu         GET  /api/food/restaurants/:id        (categories + items)
Build cart        POST /api/food/cart/items ...         (server owns quantities)
Checkout          POST /api/food/orders                 (server recomputes ALL money)
                    → 422 min_order (< 30 SAR) | outside_radius (> 15 km)
Pay (STC Pay)     POST /api/food/orders/:code/pay/signed-url → upload proof → POST .../pay
Pay (cash)        chosen at checkout; rider collects at the door
Merchant/Admin    accept (credit-gated) → preparing → ready
Dispatch          nearest online rider gets a 30s offer → accept  (or open pool)
Rider             picked_up (photo at restaurant) → out_for_delivery
Rider             delivered (handover photo; cash recorded here)
Customer          rate the rider (1-5 stars, once)
```

Order status ladder (`order_status`): `pending` → `accepted` → `preparing` → `ready` →
`out_for_delivery` → `delivered` (or `cancelled` / `rejected`). Payment status
(`fd_payment_status`): `awaiting` → `paid` → (`failed` / `refunded`).

**Photo proof is mandatory** at both rider steps (Grab-style accountability): a photo of the order
**at the restaurant** before "on the way", and a **handover** photo before "delivered". The backend
rejects the status change without the photo. Photos live in the private `driver-docs`/proofs bucket
under the order code; admins view them via short-lived signed URLs.

---

## 6. Dispatch & auto re-dispatch

Food deliveries use the same Grab-style cascade as rides (see
[SMARTMAPPIA.md §8](../SMARTMAPPIA.md#8-grab-style-dispatch-both-services)). A delivery becomes
dispatchable once the order is **accepted and paid** (or cash-on-delivery). The nearest online
approved rider gets an exclusive 30 s offer; decline/timeout cascades to the next-nearest; when all
pass it drops to the open pool. Double-claim safety is layered (unique pending-offer index + two
compare-and-swaps).

**Auto re-dispatch (before pickup):**
- Rider **cancels** — `POST /api/driver/deliveries/:code/cancel` → `releaseFoodDelivery()` clears
  `deliveries.driver_id`, sets status `searching`, re-runs `offerNext`. The canceller is excluded
  from the re-offer.
- Rider **disconnects** — the watchdog `sweepAbandonedDeliveries()` reclaims an `assigned`
  (pre-pickup) delivery whose rider's GPS is stale past `DISPATCH_ABANDON_MINUTES` (5).
- The customer's tracking page shows a **"Finding you a rider…"** state; the customer + old rider
  are notified (`food_finding_new_rider`, `food_delivery_cancelled`/`food_delivery_reclaimed`).

After pickup (`picked_up`/`out_for_delivery`) auto-reclaim is refused — the food is with the rider;
that is a support/admin case.

---

## 7. Payments

- **STC Pay (manual, live):** `POST /api/food/orders/:code/pay/signed-url` → direct upload to the
  private proofs bucket → `POST /api/food/orders/:code/pay` (records the path) → the order is
  `awaiting` until an **admin verifies** → `paid`. Accepted files JPEG/PNG/WebP/PDF ≤ 10 MB.
- **Cash on delivery (live):** chosen at checkout; the rider collects the total at the door;
  marking `delivered` records the payment (`markOrderPaid`, idempotent).
- **Tap (deferred):** schema-ready, backend not built; the UI shows "coming soon". See
  [SMARTMAPPIA.md §9.3](../SMARTMAPPIA.md#9-payments).

Idempotency: checkout accepts an `Idempotency-Key`; payments are additionally DB-idempotent via the
unique `order_payments.gateway_transaction_id` index.

---

## 8. Pricing: current credit model & approved payout-ledger model

### 8.1 Current (live) — restaurant pays the margin from credit

The customer pays **base price + delivery**. On **accept**, the platform margin (5/3 per item) is
charged to the restaurant's **300 SAR credit** (`merchant_credit_ledger`, `credit_used`). The
restaurant effectively owes the platform; the 80% alert + 300 auto-suspend protect against runaway
debt. This is what the code does today.

### 8.2 Approved, pending (migration 0017) — customer pays the markup + payout ledger

**Decided 2026-07-06 (Option B).** The money flow **inverts**: the customer pays **base + markup +
delivery**; the platform already holds the markup after payment; the platform now **owes the
restaurant** its food subtotal.

- **Three prices per item:** base price (→ restaurant, `menu_items.price`), markup (→ Smart Mappia,
  `menu_items.markup` or `merchants.default_markup`), customer price = base + markup (derived,
  shown on the menu as one number).
- **Markup resolution (per unit):** item `markup` → restaurant `default_markup` → type default
  (5 meal / 3 drink). Backward compatible: unset = today's 5/3 behavior. Flat SAR amounts only
  (no percentages in v1).
- **Order math:** `food_subtotal = Σ base×qty` (owed to restaurant); `markup_total = Σ markup×qty`
  (platform revenue); `items_subtotal = food_subtotal + markup_total`; `total = items_subtotal +
  10 SAR delivery`. Min-order check applies to **`food_subtotal ≥ 30`**.
- **Ledger becomes a payout ledger:** `credit_ledger_type` gains `accrual` + `payout`;
  `balance_after` is the running **payable** (what we owe). **Accrue on `delivered`** (reverse on
  refund/cancel), not on accept.
- **Ship atomically:** the markup change and the `acceptOrder` change (stop charging the
  restaurant's credit) MUST land in the same release, or the customer pays the markup *and* the
  restaurant's credit is drained, auto-suspending every restaurant at 300.
- **Reuse columns — do not add** `orders.food_subtotal`/`order_items.base_price`: `orders.subtotal`
  already equals the restaurant's food total, `orders.platform_margin_total` = markup total,
  `order_items.margin_per_item`/`margin_total` snapshot the resolved markup. Only `orders.total`'s
  formula changes (old paid rows stay correct; no backfill).

Touch points when implementing: `lib/foodMoney.js` (markup resolution + split), `food/
ordersController.js` (checkout snapshot), `food/adminFoodController.js` (`acceptOrder` stops
charging credit), `FoodAdmin.jsx` (markup + default-markup fields), customer menu/receipt.

---

## 9. Database: schema, enums & migrations

**Tables:** `merchants`, `menu_categories`, `menu_items`, `carts`, `cart_items`, `orders`,
`order_items`, `order_payments`, `deliveries`, `merchant_credit_ledger`, `ratings`, plus the
shared `dispatch_offers`, `driver_locations`, `profiles`, `audit_logs`, `notification_events`.

Selected columns:
- `merchants`: `id, owner_id (nullable), name, cuisine_type, description, logo_url, address, lat,
  lng, service_radius_km, is_active, status (active|suspended), credit_limit, credit_used,
  is_featured, badge, created_at` (+ pending `default_markup`).
- `menu_items`: `id, merchant_id, category_id, name, description, price, item_type
  (meal_package|drink_dessert_addon), image_url, is_available` (+ pending `markup`).
- `orders`: `id, order_code, customer_id, merchant_id, status, payment_status, payment_method,
  subtotal, delivery_fee, platform_margin_total, total, delivery_address, delivery_lat/lng,
  reject_reason, created_at`.
- `deliveries`: `id, order_id (unique), driver_id (nullable, on delete set null), fee, status
  (free-text: searching|assigned|open|picked_up|delivered), pickup_photo_path,
  delivery_photo_path, picked_up_at, delivered_at, created_at`.

**Enums:** `order_status`, `fd_payment_status` (`awaiting|paid|failed|refunded`),
`fd_payment_method` (`stcpay|tap|cash`), `merchant_status` (`active|suspended`), `item_type`,
`user_role` (gains `merchant`), `credit_ledger_type` (gains `accrual|payout` in 0017),
`dispatch_offer_status`.

**RLS:** every table has row-level security; public discovery exposes only active/listed
restaurants and safe fields; owners/admins see their own; all writes go through the backend
service-role key.

**Migrations (order):** `0009` food core (merchants/menus + `merchant` role) · `0010` orders +
payments + deliveries · `0011` credit ledger · `0012` extras · `0013` dispatch + merchant vetting
(unlisted default, nullable owner) · `0014` driver ratings · `0015` merchant homepage presentation
(featured + badge) · `0016` audit hardening. **`0017`** (customer-markup + payout ledger) is
**pending** — additive/enum-additive, safe on the live DB. Full per-entity tables and the Mermaid
diagram are preserved in [../archive/food-delivery/FOOD_DELIVERY_ERD.md](../archive/food-delivery/FOOD_DELIVERY_ERD.md)
and [../archive/production/db/DATABASE_ERD.md](../archive/production/db/DATABASE_ERD.md).

---

## 10. API reference

Base `https://api.smartmappia.com`. Bearer token on all but public endpoints.

**Customer**
- `GET /api/food/restaurants?q=&cuisine=&featured=` (public) — discovery.
- `GET /api/food/restaurants/:id` (public) — menu (categories + items).
- `GET /api/food/cart?merchant_id=` · `POST /api/food/cart/items` · `PATCH|DELETE /api/food/cart/items/:id`.
- `POST /api/food/orders` — checkout (recomputes money; `Idempotency-Key` header; 422 with
  `failure_reason`).
- `GET /api/food/orders` · `GET /api/food/orders/:code` (polled on tracking).
- `GET|POST /api/food/orders/:code/pay` · `POST /api/food/orders/:code/pay/signed-url`.
- `POST /api/food/orders/:code/rate-driver`.

**Rider (driver)**
- `GET /api/driver/offers` · `POST /api/driver/offers/:id/accept|decline`.
- `GET /api/driver/deliveries` · `GET /api/driver/deliveries/available` ·
  `POST /api/driver/deliveries/:code/claim`.
- `POST /api/driver/deliveries/:code/cancel` — give up before pickup (auto re-dispatch).
- `POST /api/driver/deliveries/:code/photo-url` · `POST /api/driver/deliveries/:code/status`
  (`picked_up`/`delivered`, photo path required).

**Admin (role admin)** — under `/api/admin/food/`
- `GET overview` · `GET|POST merchants` · `PATCH|DELETE merchants/:id`.
- `POST merchants/:id/image/signed-url` — logo/menu image upload URL.
- `POST merchants/:id/owner` — create/link owner account.
- `POST merchants/:id/suspend|reactivate|credit`.
- `GET merchants/:id/menu` · category + item CRUD (`.../menu/categories`, `/categories/:id`,
  `.../menu/items`, `/items/:id`).
- `GET orders` · `POST orders/:code/accept|reject|verify-payment|reject-payment|cancel|refund`
  · `PATCH orders/:code/status` · `POST orders/:code/assign-driver` · `GET orders/:code/photos`.

---

## 11. Restaurant & menu images (public bucket)

Logos and menu photos are **file uploads** (not URLs) to the **public** `merchant-images` bucket,
reusing the signed-upload pattern. Flow:

```
Admin picks JPG/PNG/WebP (logo) or JPG/PNG (menu)   [validated client-side: uploadFiles.js]
  → POST /api/admin/food/merchants/:id/image/signed-url { kind:'logo'|'item', file_name, mime_type }
      → { bucket, path, token, publicUrl, maxBytes }
  → browser uploads straight to Storage (uploadProofFile)
  → save publicUrl into merchants.logo_url (PATCH merchant) or menu_items.image_url (item save)
```

Key files: `lib/config.js` (`merchantImages`), `lib/storage.js`
(`buildMerchantImagePath`/`createMerchantImageUploadUrl`/`merchantImagePublicUrl`),
`lib/uploadValidation.js` (`validateImageFile` logos, `validateMenuImageFile` menu),
`food/adminFoodController.js` (endpoint), `FoodAdmin.jsx` `ImageUploadField`. Public because the
photos are shown to customers via a plain `<img src>`; uploads still use the service-role key.
New restaurants must be **saved first** (the upload path needs the merchant id). Existing external
URLs still render (columns are unchanged text).

---

## 12. Owner accounts

Owner accounts are **provisioned by an admin at the contract-signing stage** — never self-service.
`POST /api/admin/food/merchants/:id/owner` `{ email, full_name?, phone? }`:
1. creates a confirmed auth user (or reuses an existing account by email),
2. upserts the profile with `role = 'merchant'` + contact details,
3. sets `merchants.owner_id`,
4. writes `audit_logs: admin_merchant_owner_linked`.

Re-linking is blocked (409) if an owner already exists. The account enables owner-targeted
notifications now and a future merchant-portal login. The admin Food tab shows owner status per
restaurant ("Assign owner" / linked email). Controller/UI: `food/adminFoodController.js`
`setMerchantOwner` + `listMerchants` (returns `ownerId`/`ownerEmail`), `FoodAdmin.jsx`.

---

## 13. Tracking UI

`FoodTrackPage` ([`portal/food/FoodTrackPage.jsx`](../../frontend/src/portal/food/FoodTrackPage.jsx))
is a foodpanda-style live tracker: an **ETA hero** (big estimate + phase label + slim progress bar,
live badge), the full status stepper, a **live map** (the rider pin glides on every GPS ping,
restaurant + drop-off pins), a **rider card** (name + one-tap Call/WhatsApp), an **order-details
block** (order number / from / address / total), an itemized **receipt** with a "Paid with" line, a
**"Finding you a rider…"** state when the rider is dropped (cancel/disconnect), inline payment for
awaiting online payment, and on delivery a thank-you + **PDF receipt** + rate-driver. The ETA hero,
order-meta, and receipt are built as reusable presentational components so the upcoming **ecommerce**
order-status page can share them. Realtime first (`fd-order-<code>` channel) with 8 s polling
fallback.

---

## 14. Analytics events

Lowercase_with_underscores, logged via `lib/foodEvents.js` → `logFoodEvent`:

| Event | Trigger | Params |
|---|---|---|
| `view_menu` | Restaurant profile opened | `restaurant_id, cuisine_type` |
| `add_to_cart` | Item added | `item_id, price, quantity` |
| `checkout_attempt` | Checkout clicked | `order_total, failure_reason` |
| `payment_success` | Payment confirmed | `transaction_id, payment_method, amount` |
| `merchant_order_accept` | Order accepted | `order_id, merchant_id` |
| `credit_limit_warning` | Credit hits 80% | `current_usage, merchant_id` |
| `service_suspended` | Credit reaches 300 | `final_balance, merchant_id` |

---

## 15. Operations runbook

- **Onboard a restaurant:** Food tab → Add restaurant (starts Unlisted) → upload logo → import
  categories + items (upload photos) → (at contract signing) Assign owner → flip Listed.
- **Feature a restaurant:** toggle `is_featured` / set a `badge` (top_rated/popular/new/trending)
  — drives the homepage grid (migration 0015).
- **Handle an order:** verify STC payment (or accept cash on delivery) → Accept (credit-gated) →
  advance Preparing → Ready → rider auto-offered (or Assign rider manually) → rider pickup/delivery
  photos → delivered.
- **Credit (current model):** monitor 300 SAR usage; 80% alert at 240; auto-suspend at 300;
  "Reconcile" after the restaurant settles.
- **Support:** cancel any live order (paid → tell the customer refunds take a few hours up to
  14 days, then Mark refunded). View rider proof photos via signed URLs.
- **Create an admin:** `npm run seed:admins` (Ruth, Nawaf) + ensure emails are in `ADMIN_EMAILS`.

---

## 16. QA plan

**Ordering & money**
1. Cart below 30 SAR food subtotal → checkout `422 min_order`; above → proceeds.
2. Delivery address > 15 km → `422 outside_radius`.
3. STC Pay: upload proof → admin verify → order `paid`. Cash: rider marks delivered → payment
   recorded.

**Merchant catalog & images**
4. Add restaurant → save → edit → upload a logo (JPG/PNG/WebP) and a menu photo (JPG/PNG); reject a
   PDF/oversized file; images render on the storefront + homepage.
5. Assign owner (fresh email) → button shows linked; `profiles.role='merchant'`,
   `merchants.owner_id` set, audit row written; re-assign → 409.

**Dispatch & re-dispatch**
6. Accept an order as rider A → **Cancel before pickup** → re-offered to rider B; customer sees
   "Finding you a rider"; audit `driver_delivery_cancelled`.
7. Accept, then let GPS go stale past `DISPATCH_ABANDON_MINUTES` → watchdog releases + re-offers;
   does **not** reclaim once `picked_up`.
8. Two riders can't both hold the same job (CAS holds).

**Tracking**
9. `/food/track/:code` across statuses (awaiting → preparing → out for delivery → delivered):
   ETA hero, progress bar, order details, receipt with "Paid with", live map, rider card, PDF, and
   rate-driver all render; responsive.
