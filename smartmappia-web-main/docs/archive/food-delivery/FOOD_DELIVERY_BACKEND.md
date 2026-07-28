# SmartMappia — Food Delivery: Backend Build Plan (for Opus)

How to build the Food Delivery backend **on the existing SmartMappia Express + Supabase backend**.
Reuse everything already there: the JWT auth middleware, `lib/config.js`, `lib/supabase.js`
(service_role), `lib/storage.js` (signed URLs), `middleware/rateLimiters.js`, the payments pattern
(manual STC Pay + deferred Tap), and the realtime broadcast helpers. New code lives in
`controllers/food/*` and `routes/food.js`, `routes/merchant.js`.

Data model + migrations: see `FOOD_DELIVERY_ERD.md`. Product rules: see `FOOD_DELIVERY_PRD.md`.

---

## 1. Non-negotiable principles (enforce server-side, always)
1. **Never trust client-sent money.** The server recomputes `subtotal`, `margin_total`,
   `delivery_fee`, and `total` from the DB menu prices at checkout. Reject mismatches.
2. **30 SAR minimum** — checkout returns `422` with `failure_reason: "min_order"` if subtotal < 30.
3. **Merchant credit** — a merchant with `credit_used ≥ credit_limit (300)` **cannot accept** orders
   (`403`). Emit the 80% alert at 240.
4. **No raw payment data** — store only the gateway `transaction_id`/token. PCI-DSS by design.
5. **RBAC + ownership** — every merchant/customer/admin action verifies the caller owns the resource
   (a merchant can only touch their own restaurant/menu/orders).
6. **Idempotency** — payment confirmation and gateway webhooks must be idempotent (dedupe by
   `transaction_id`).
7. **Audit logging** — log every access to sensitive data / privileged action (who, what, when).

---

## 2. Middleware & cybersecurity (build/extend)

Reuse: `requireAuth`, `requireAdmin` (from `middleware/auth.js`), Helmet, CORS allow-list, central
error handler, `trust proxy`, per-endpoint rate limiting.

Add:
- **`requireMerchant`** — `requireAuth` + `role === 'merchant'` (or admin), sets `req.merchantId` and
  loads the caller's `merchants` row (`req.merchant`). Reject if no active restaurant.
- **`requireMerchantOwnsOrder` / `...OwnsItem`** — verify the target order/menu item belongs to
  `req.merchantId` before mutation.
- **Input validation layer** — validate every request body (a small schema per route, e.g. with
  `zod`); reject unknown/extra fields; coerce/limit types. Prevents injection + malformed data.
- **Rate limiters** — add limiters for search, checkout, order-accept, and payment endpoints.
- **Idempotency middleware** — accept an `Idempotency-Key` header on checkout/payment; dedupe.
- **Audit logger** — a helper `logAudit({ actorId, action, resourceType, resourceId, meta })`
  writing to an `audit_logs` table (immutable). Wrap admin actions (suspend, reconcile), payment
  confirmations, and any read of another user's PII.
- **Security headers / transport** — HTTPS is terminated at Nginx (TLS 1.3); Supabase encrypts at
  rest (AES-256). Ensure no secrets in logs; scrub tokens/PII from log lines.

---

## 3. Endpoints to build

### Customer (`routes/food.js`, `requireAuth` unless public)
- `GET /api/food/restaurants` (public) — active restaurants; `?q=` (name), `?cuisine=` filter.
- `GET /api/food/restaurants/:id` (public) — restaurant + categories + available items.
- `GET /api/food/cart?merchant_id=` — the caller's cart for a merchant.
- `POST /api/food/cart/items` `{ menu_item_id, quantity }` — add/update (server reads price).
- `PATCH /api/food/cart/items/:id` `{ quantity }` · `DELETE /api/food/cart/items/:id`.
- `POST /api/food/orders` `{ merchant_id, delivery_address, lat, lng }` — **checkout**: server builds
  the order from the cart, recomputes money, enforces 30 SAR min + distance/delivery fee, creates the
  order `pending` / `awaiting` payment, clears the cart. Returns the order + payment next-step.
- `POST /api/food/orders/:code/pay` — start payment. **STC Pay (manual)**: signed-URL proof upload +
  record (reuse the Pick & Drop proof flow). **Tap (deferred)**: create charge → hosted URL; webhook
  confirms.
- `GET /api/food/orders/:code` — tracking (status timeline). `GET /api/food/orders` — order history.

### Merchant (`routes/merchant.js`, `requireMerchant`)
- `GET /api/merchant/restaurant` · `PATCH /api/merchant/restaurant` — own restaurant.
- Menu CRUD: `POST/PATCH/DELETE /api/merchant/menu/categories` · `.../items` (ownership-checked;
  price/availability updates).
- `GET /api/merchant/orders` — incoming/live orders (realtime broadcast + polling fallback).
- `POST /api/merchant/orders/:code/accept` — **checks `credit_used < credit_limit`**; on success
  writes a `charge` to `merchant_credit_ledger`, increments `credit_used`, sets order `accepted`,
  fires 80% alert if crossed, and broadcasts status.
- `POST /api/merchant/orders/:code/reject` · `PATCH /api/merchant/orders/:code/status`
  (`preparing` → `ready` → `out_for_delivery` → `delivered`).
- `GET /api/merchant/credit` — balance + ledger history.

### Admin (extend `routes/admin.js`, `requireAdmin`)
- `GET /api/admin/food/overview` — volume, health, revenue (sum of margins).
- `GET /api/admin/food/merchants` — all merchants + credit usage.
- `POST /api/admin/food/merchants/:id/suspend` / `/reactivate`.
- `POST /api/admin/food/merchants/:id/credit` — replenish/reconcile (writes ledger).
- Catalog oversight: read/CRUD any menu (for content moderation).

### Analytics
- `POST /api/food/events` (or server-side calls) writing `fd_analytics_events` for the PRD events
  (`view_menu`, `add_to_cart`, `checkout_attempt` with `failure_reason`, `payment_success`,
  `merchant_order_accept`, `credit_limit_warning`, `service_suspended`).

---

## 4. Payments (reuse Pick & Drop approach)
- **STC Pay (manual, live path):** customer uploads a transfer proof via signed URL to a private
  bucket; an admin (or the merchant, if allowed) verifies; order → `paid`. Store only the reference.
- **Tap (online, deferred):** `POST /api/food/orders/:code/tap-charge` returns a hosted URL; a signed
  **webhook** (`/api/food/webhooks/tap`) is the source of truth. Store `transaction_id` + `gateway_raw`
  only. Backend env: `TAP_SECRET_KEY`, `TAP_PUBLIC_KEY`, `TAP_WEBHOOK_SECRET`, `TAP_MERCHANT_ID`.
- Never store card numbers / CVV / expiry.

---

## 5. Build order (to-do for Opus)
1. **Migrations** `0009`–`0012` (see ERD) applied to a dev Supabase; verify RLS.
2. **Config + lib**: extend `lib/config.js` (food constants: `MIN_ORDER=30`, `DELIVERY_FEE=10`,
   `RADIUS_KM=15`, margins `{meal_package:5, drink_dessert_addon:3}`, `MERCHANT_CREDIT_LIMIT=300`,
   `CREDIT_ALERT_PCT=0.8`). Add `lib/foodMoney.js` (single source of truth for the math) and
   `lib/audit.js`.
3. **Middleware**: `requireMerchant`, ownership guards, input-validation helper, idempotency, audit.
4. **Customer controllers/routes**: restaurants/search, cart, checkout (money + 30 SAR), payment,
   tracking, history.
5. **Merchant controllers/routes**: restaurant + menu CRUD, orders accept/reject/status (credit
   check + ledger), credit view.
6. **Admin**: overview, merchant management, suspend/reconcile, catalog oversight.
7. **Analytics events** wired into the flows.
8. **Realtime**: broadcast order-status changes to customer + merchant (reuse `lib/realtime.js`
   channels, e.g. `fd-order-<code>`, `merchant-<id>`).
9. **Tests / smoke**: checkout below 30 SAR → 422; accept with 0 credit → 403; money recomputation
   ignores client totals; webhook idempotency.

---

## 6. Definition of done
- A customer cannot pay for a sub-30-SAR cart (server-enforced, not just UI).
- A merchant cannot accept an order at/over the 300 SAR credit limit; the 80% alert fires once.
- Order totals, margins, and delivery fee are computed server-side from DB prices; client values are
  ignored.
- No raw payment data stored anywhere; only tokens/transaction ids.
- All privileged actions and PII reads are audit-logged; RLS restricts cross-tenant access.
