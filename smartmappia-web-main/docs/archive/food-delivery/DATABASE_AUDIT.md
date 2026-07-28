# SmartMappia — Food Delivery Database Audit

**Date:** 2026-07-06 · **Scope:** migrations `0001-0015` (base + food) cross-checked
against the live `backend/` code · **Method:** five independent review passes
(security, schema architect, lean/scope, DBA/production-readiness, CTO/money-model), each
verified against the actual files — no unverified claims.

---

## Headline verdict

**The food-delivery data model is well-architected, secure by design, complete, and NOT
over-engineered. There are zero correctness or parity bugs in the schema.** Code↔schema
parity is 100% — every table, column, enum, and function the backend uses exists, all
money/idempotency constraints are present, and the migrations apply cleanly in order and
are re-runnable.

**It is not yet production-ready — for one hard reason and a short hardening list:**

- **1 CRITICAL, launch-blocking:** the frontend `.env` currently holds the Supabase
  **`service_role`** key. Any build ships full, RLS-bypassing database access to every
  visitor. This must be fixed before **any** deploy. (It is a config/secret issue, not a
  schema flaw — but it nullifies every good RLS policy below.)
- **A handful of hardening items** (indexes, retention, a review-forgery RLS gap, money
  CHECK guards) — none are rewrites; all are targeted, low-risk fixes.

Per the agreed process this is **report-first**: no schema changes were applied in this
pass. The remediation plan (end of doc) lists exactly what to fix and in what order.

---

## Findings (severity-ranked, deduped)

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| 1 | **CRITICAL** | Frontend ships the `service_role` key → any build hands full RLS-bypassing DB access to every visitor | `frontend/.env` (`VITE_SUPABASE_ANON_KEY` decodes to `role: service_role`); known open in `SECURITY_TODO.md` | Replace with the real **anon** key; **rotate** the exposed service_role key in Supabase; never expose it in a `VITE_*` var. Do **not** build/deploy until done. |
| 2 | **HIGH** | Review forgery: customers can attribute a star rating to **any** restaurant | `ratings` RLS `ratings_customer_insert` (`0012`) checks the order is theirs but not that `merchant_id` = the order's merchant, nor `status='delivered'`; homepage reads it (`restaurantsController.js`) | Route rating writes through a server controller with ownership+delivered checks, **or** tighten the policy to bind `merchant_id` to the order and require delivered. |
| 3 | **HIGH** | `driver_locations` sequential scan on the dispatch hot path | `dispatch.js` filters `recorded_at >= since` (no `driver_id`); only index is `(driver_id, recorded_at)` — leading col unused | Add `create index on driver_locations (recorded_at desc)` (ideally partial on approved drivers). |
| 4 | **HIGH** | Unbounded tables, no retention/pruning | `driver_locations`, `fd_analytics_events`, `audit_logs`, `dispatch_offers`, `order_payments` | Scheduled retention (e.g. keep `driver_locations` 7-30d; archive analytics/audit). Ops task, not a migration. |
| 5 | MEDIUM | `orders` / `order_items` / `order_payments` money columns lack `CHECK (>= 0)` | `0010` (server-computed today, but no DB guard) | Add non-negative checks (mirrors the correct guards on `menu_items.price`, ledger `amount`). |
| 6 | MEDIUM | Admin order-list indexes are single-column, unusable with the `created_at desc` sort | `idx_orders_status`, `idx_orders_payment` (`0010`) vs `adminFoodController.listOrders` | Replace with composite `(status, created_at desc)` and `(payment_status, created_at desc)`. |
| 7 | MEDIUM | Open-pool query has no supporting index | `deliveries` filtered `status='open' AND driver_id IS NULL`; no `status` index | `create index on deliveries (status) where driver_id is null`. |
| 8 | MEDIUM | `ratings` table has **no writer** → homepage stars are always empty | read/aggregated in `restaurantsController.js`, but only `driver_ratings` is ever inserted | Build a customer "rate restaurant" endpoint (also closes #2), or drop the aggregation until then. |
| 9 | LOW | `deliveries.status` is unconstrained free-text; a typo silently breaks rider state | `0010` (`status text`) vs literals in `dispatch.js`/`driverDispatchController.js` | Add a `delivery_status` enum or CHECK + `NOT NULL DEFAULT 'searching'`. |
| 10 | LOW | `merchants.service_radius_km` is inert — per-restaurant radius is ignored (global `config.food.radiusKm` used) | `0009` col vs `foodMoney.js` | Wire it into `priceOrder`, or drop the column. |
| 11 | LOW | `merchants.credit_used` allows negative (JS-only floor) | `0009` (no `CHECK`) | Add `check (credit_used >= 0)` (revisit under the payout-ledger model). |
| 12 | LOW | All active promo codes are world-readable | `promocodes_public_select` = `using (active or is_admin())` (`0012`); unused today | Don't expose the code list; validate a submitted code server-side. |
| 13 | LOW | Tap webhook uses non-constant-time signature compare; HMAC over re-serialized JSON | `ordersController.tapWebhook` (fails closed; path disabled while unconfigured) | Use `crypto.timingSafeEqual`; confirm Tap's signing bytes before go-live. |
| 14 | LOW | 3 redundant indexes duplicate unique-constraint auto-indexes; several FK columns unindexed | `idx_merchants_owner`, `idx_deliveries_order`, `idx_cart_items_cart`; FKs like `order_items.menu_item_id` | Drop the redundant three; add FK indexes only if those joins/cascades get exercised at scale. |

---

## What is strong (verified correct — do not touch)

- **Code↔schema parity: 100%.** No missing table/column/enum/function; every value the
  code writes is in-enum. Migrations `0009-0015` apply in order on a DB at `0001-0008`,
  no forward references, fully idempotent (guarded enums, `if not exists`, `drop policy if
  exists`, `add value if not exists`). The `alter type ... add value 'merchant'` is safe
  (never used in the same transaction).
- **Security model is sound.** RLS is enabled on **all 16** food tables. The money tables
  (`orders`, `order_payments`, `merchant_credit_ledger`) are **SELECT-only** for clients —
  no INSERT/UPDATE policy, so client writes are denied by default. Money is
  server-authoritative: checkout re-reads live prices and recomputes via `foodMoney.js`;
  client totals are structurally impossible (rejected by `validateBody`). No IDOR —
  ownership + admin gating everywhere, atomic driver claims.
- **PCI posture is clean.** No card number/CVV/expiry stored or logged anywhere; only
  gateway tokens/txn ids. Tap is a hosted redirect; the webhook returns 503 when
  unconfigured and payment confirmation is idempotent via the unique
  `order_payments.gateway_transaction_id` index.
- **Money integrity.** All money is `numeric(10,2)`. Concurrent order-accept cannot
  double-charge credit — it uses compare-and-swap on `merchants.credit_used` with a
  rollback if the order-status flip loses the race.
- **Snapshots** (`order_items`, `orders`) are immutable and truthful; hot paths (customer
  history, credit ledger, driver offers) are correctly indexed; audit logging covers
  privileged actions and PII reads into an append-only `audit_logs`.
- **Not over-engineered.** `ratings` and `promocodes` are unused but are documented
  roadmap (STATUS §8), not dead code. `0013`'s re-assertions are harmless idempotency.

---

## Option-1 pricing readiness (payout ledger + customer-paid markup)

The boss chose **Option 1** (repurpose the 300 SAR credit system as a payout ledger). The
schema is close to ideal — the change is **additive**, not a rebuild:

- **Add (nullable, safe on a live DB):** `menu_items.markup numeric(10,2)`,
  `merchants.default_markup numeric(10,2)`.
- **Enum:** `credit_ledger_type` gains `accrual` + `payout` (`add value if not exists`).
- **Reuse as-is (no new columns):** `orders.subtotal` already equals the restaurant's food
  total; `orders.platform_margin_total` = our markup total; `order_items.margin_per_item`/
  `margin_total` snapshot the resolved markup. Only `orders.total`'s **formula** changes
  (now includes markup) — old rows stay correct, no backfill. The
  `merchant_credit_ledger.balance_after` **meaning** flips (running payable, not debt) —
  no structural change.

**Two must-dos flagged by the review:**
1. **Ship the markup change and the `acceptOrder` change together.** If markup starts
   hitting the customer's `total` while `acceptOrder` still debits the restaurant's credit,
   you **double-charge** and every restaurant auto-suspends at 300. This is the biggest
   money landmine — atomic release only.
2. **Accrue the payable on `delivered`, not on accept**, and reverse on refund/cancel —
   otherwise you owe restaurants for orders that never arrive.

(The earlier `FOOD_PRICING.md` draft's proposed `orders.food_subtotal` /
`order_items.base_price` columns are **not needed** — reuse the existing columns above.)

---

## Remediation plan (ordered)

**Before any production deploy (blocking):**
1. Fix #1 — swap the frontend key to `anon`, rotate the `service_role` key. (No schema.)
2. Fix #2/#8 together — move restaurant ratings to a server endpoint (ownership + delivered),
   tighten/remove the client insert policy. (Small migration + endpoint.)
3. Confirm launch env gates (already tracked in `SECURITY_TODO`/`LAUNCH_CHECKLIST`):
   `AUTO_VERIFY_STCPAY_TEST_MODE=false`, driver auto-approve reverted (code already safe),
   CORS locked to prod origin.

**Before scale / with the next migration (0016), non-blocking:**
4. Indexes: #3 (`driver_locations(recorded_at)`), #6 (composite `orders`), #7
   (`deliveries(status)` partial). 
5. Money CHECK guards #5; `deliveries.status` enum #9; `credit_used >= 0` #11.
6. Retention jobs #4 (ops).
7. Minor cleanups #10, #12, #13, #14 as convenient.

**Verdict:** architecturally ready and correct; operationally blocked only by the
`service_role` key. Everything else is targeted hardening that can ride the next migration.
