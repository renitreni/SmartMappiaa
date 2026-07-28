# SmartMappia — Food Delivery: AI Build Prompts

Copy-paste prompts to drive the build. All four planning docs live in
`smartmappia-web-main/docs/food-delivery/`: `FOOD_DELIVERY_PRD.md` (requirements),
`FOOD_DELIVERY_ERD.md` (data model + migrations), `FOOD_DELIVERY_BACKEND.md` (backend plan),
`FOOD_DELIVERY_FRONTEND.md` (design brief). Point each model at the repo so it can read them.

---

## Prompt A — Fable 5 (frontend design)

> You are designing the **SmartMappia Food Delivery** frontend, built INSIDE the existing SmartMappia
> React app (React 19 + Vite + Tailwind). First read `docs/food-delivery/FOOD_DELIVERY_PRD.md` and
> `docs/food-delivery/FOOD_DELIVERY_FRONTEND.md`, and study the existing design system in
> `frontend/src/portal/components/ui.jsx` and the existing rider/driver/admin portals and the
> marketing `Restaurants`/`Shop` sections.
>
> Design high-fidelity, fully responsive (mobile-first) screens for the **customer** experience
> (discovery/home, restaurant menu, cart, checkout, order tracking, order history) and the
> **merchant** experience (dashboard, live orders, menu/inventory, finances), plus an admin "Food"
> tab. Match the existing brand exactly (orange `#FF7E21`→red gradient, brand-black, rounded-2xl
> cards, Lucide icons) and REUSE `PortalShell`, `Card`, `Badge`, `Spinner`, `btnPrimary`, `Field` —
> do not invent a parallel component set.
>
> You MUST design every critical state explicitly:
> - **30 SAR minimum order:** on cart + checkout, show the shortfall and disable the Checkout/Pay
>   button when subtotal < 30 SAR (design enabled vs disabled).
> - **Merchant credit:** balance widget with normal / **80% warning (240 SAR)** / **suspended
>   (300 SAR)** states; when suspended, the Accept button is disabled with a clear banner.
> - Item unavailable, outside delivery radius, payment pending/failed, and all empty/loading states.
>
> Payment methods: **STC Pay** (manual — show the pay number + a proof-upload control) and **Tap**
> ("coming soon", disabled). Currency shown as `SAR 30.00`. No emojis in the UI.
>
> Deliverables: the screens above (desktop + mobile) with every error/empty/loading state, a
> clickable prototype of the critical path (discover → menu → cart with the 30 SAR gate → checkout →
> track; merchant receive → accept with the credit gate → preparing → ready), and component specs
> mapped to the existing Tailwind tokens so implementation is a straight build.

---

## Prompt B — Opus (database + backend)

> You are building the **SmartMappia Food Delivery** backend ON the existing SmartMappia Express +
> Supabase backend (`smartmappia-web-main/backend`). First read
> `docs/food-delivery/FOOD_DELIVERY_PRD.md`, `docs/food-delivery/FOOD_DELIVERY_ERD.md`, and
> `docs/food-delivery/FOOD_DELIVERY_BACKEND.md`. Reuse the existing auth middleware
> (`middleware/auth.js`), `lib/config.js`, `lib/supabase.js` (service_role), `lib/storage.js`,
> `middleware/rateLimiters.js`, `lib/realtime.js`, and the payment/proof patterns — do NOT rebuild
> them.
>
> Step 1 — Database: write migrations `0009`–`0012` per `FOOD_DELIVERY_ERD.md` (merchant role value;
> merchants, menu_categories, menu_items; carts/cart_items/orders/order_items/order_payments/
> deliveries; merchant_credit_ledger; ratings/promocodes/fd_analytics_events; enums; `gen_order_code()`
> with an `FD-` prefix; indexes; RLS policies on every table). Provide them as runnable SQL files.
>
> Step 2 — Backend: implement the customer, merchant, and admin endpoints in
> `FOOD_DELIVERY_BACKEND.md`, plus the middleware: `requireMerchant`, ownership guards, an
> input-validation layer, idempotency for payment/webhook, and an audit logger.
>
> Enforce these rules SERVER-SIDE (never trust the client):
> 1. Recompute `subtotal`, per-item margin (5 SAR meal_package / 3 SAR drink_dessert_addon),
>    `delivery_fee` (10 SAR within 15 km), and `total` from DB prices at checkout.
> 2. **Reject checkout when subtotal < 30 SAR** (`422`, `failure_reason: "min_order"`).
> 3. A merchant with `credit_used >= 300` **cannot accept** orders (`403`); emit the 80% alert at 240;
>    on accept, write a `merchant_credit_ledger` charge of the order's margin_total and increment
>    `credit_used`.
> 4. Store only gateway `transaction_id`/token for payments — **never** card number/CVV/expiry.
> 5. RBAC + ownership on every action; audit-log privileged actions and PII reads.
>
> Put money math in one module (`lib/foodMoney.js`) as the single source of truth. Broadcast order
> status changes over realtime. Keep secrets out of logs. Match the existing code style, and make
> everything syntax-check and load cleanly (`node -e "require('dotenv').config(); require('./app')"`).
>
> Definition of done: a sub-30-SAR cart cannot pay; a merchant at/over 300 SAR cannot accept; totals
> are server-computed; no raw payment data stored; RLS blocks cross-tenant access.

---

## Suggested order of operations
1. Run **Prompt B, Step 1** (migrations) → review the schema → apply to a dev Supabase.
2. Run **Prompt A** (Fable) and **Prompt B, Step 2** (backend) in parallel — the API contract in
   `FOOD_DELIVERY_BACKEND.md` is the shared boundary, so design and backend stay compatible.
3. Wire the frontend build to the new endpoints; test the critical path end-to-end (30 SAR gate,
   credit gate, payment) before touching production.
