# SmartMappia — Food Delivery Pricing Model

Status: **PROPOSAL — awaiting sign-off on one decision (see section 7).**
Owner: pricing / money engine. Companion to `FOOD_DELIVERY_PRD.md` (§7) and the
server-side money source of truth `backend/lib/foodMoney.js`.

This document defines how a food order is priced end to end: what the restaurant is
paid, what SmartMappia keeps, and what the customer is charged. It replaces the
"restaurant pays the margin from its credit" rule in the original PRD §7 with a
**customer-pays-the-markup** model, and adds **admin-set markup per item and per
restaurant**.

---

## 1. The three prices on every item

| Name | Who sets it | Who receives it | Stored as |
|---|---|---|---|
| **Base price** | Admin (per item) | The **restaurant** (their food revenue) | `menu_items.price` |
| **Markup** | Admin (per item, or per restaurant default) | **SmartMappia** (our revenue) | `menu_items.markup` / `merchants.default_markup` |
| **Customer price** | Computed = base + markup | Shown on the menu; the customer pays it | not stored — derived |

The customer sees **one** number on the menu (base + markup). The split is internal:
it only matters for settlement (what we owe the restaurant vs. what we keep).

---

## 2. How the markup is resolved (per item, per unit)

For each menu item, the markup used is the **first** of these that is set:

1. `menu_items.markup` — the item's own markup (admin override for that dish), else
2. `merchants.default_markup` — the restaurant's default markup (applies to all its
   items that don't set their own), else
3. **Type default** — the current fixed values: **SAR 5** for `meal_package`,
   **SAR 3** for `drink_dessert_addon` (from `config.food.margins`).

This makes the change **backward compatible**: an item with no markup set and a
restaurant with no default behaves exactly like today (5 / 3 by type). Admins opt in
to custom pricing by filling the new fields.

All markups are a **flat SAR amount per unit** (same mental model as the current 5/3).
Percentage-based markup is intentionally out of scope for v1 — revisit later if needed.

---

## 3. Order money math (server-side, the only source of truth)

At checkout the backend recomputes everything from live DB rows — client-sent money is
never trusted (unchanged rule). Per order:

```
per line:
  unit_customer_price = base_price + markup        (markup resolved per section 2)
  line_food_total     = base_price × quantity      (owed to the restaurant)
  line_markup_total   = markup     × quantity      (SmartMappia revenue)

order:
  food_subtotal   = Σ line_food_total              (restaurant's take)
  markup_total    = Σ line_markup_total            (our take)
  items_subtotal  = food_subtotal + markup_total   (what the customer pays for food)
  delivery_fee    = 10 SAR (flat, within 15 km — unchanged)
  total           = items_subtotal + delivery_fee  (the customer's bill)
```

- **Minimum order:** `food_subtotal ≥ 30 SAR` (the 30 SAR rule applies to the
  restaurant's food value, not the markup). Below it → checkout 422 `min_order`.
- **Delivery fee:** unchanged — flat 10 SAR within the 15 km radius, else rejected.
- **Platform revenue per order = `markup_total` + `delivery_fee`** (delivery-fee
  treatment can be revisited; today it's collected by the platform).
- **Restaurant is owed `food_subtotal`** for each delivered order.

### Worked example

Restaurant "Kuy's", markup resolution in play:

| Item | Base | Markup (source) | Customer price | Qty |
|---|---|---|---|---|
| Isaw | 8.00 | 3.00 (type default, drink/add-on) | 11.00 | 2 |
| Chicken platter | 40.00 | 7.00 (per-item override) | 47.00 | 1 |

```
food_subtotal  = 2×8  + 1×40 = 56.00     -> owed to Kuy's
markup_total   = 2×3  + 1×7  = 13.00     -> SmartMappia revenue
items_subtotal = 56 + 13     = 69.00
delivery_fee   =               10.00
total (customer pays)        = 79.00
min-order check: food_subtotal 56.00 ≥ 30 -> OK
```

---

## 4. What changes vs. today

Today (audited build): the customer pays **base + delivery** only; our margin is
**charged to the restaurant's 300 SAR credit** on accept (the restaurant owes us).

New model: the customer pays **base + markup + delivery**; we **already hold** the
markup after collecting payment. The restaurant no longer owes us anything per order —
instead **we owe the restaurant** its `food_subtotal`.

So the money flow **inverts**: it moves from "restaurant owes platform (credit)" to
"platform owes restaurant (payout)."

---

## 5. Schema changes required

| Table | Column | Type | Notes |
|---|---|---|---|
| `menu_items` | `markup` | `numeric(10,2)` null | per-item markup override; null = fall back |
| `merchants` | `default_markup` | `numeric(10,2)` null | restaurant default; null = type default |
| `orders` | `food_subtotal` | `numeric(10,2)` | restaurant's take (new) |
| `orders` | `markup_total` | reuse `platform_margin_total` | our take — the column already exists; semantics unchanged (still "our per-order revenue") |
| `order_items` | `base_price` | reuse `unit_price` | keep as the base; **or** add `base_price` + keep `unit_price` = customer price. See decision D2. |
| `order_items` | `markup_per_item` | already exists | snapshot the resolved markup (already present) |

`orders.subtotal` today = food only. Under the new model we need both `food_subtotal`
and `items_subtotal` (food + markup). Cleanest: keep `orders.subtotal` = `food_subtotal`
and add nothing customer-facing there, since `total` already captures the bill and
`platform_margin_total` captures markup. (Final column choices in the implementation
migration — this is migration **0015**, additive and idempotent.)

---

## 6. Code + UI touch points (for the implementation phase)

- `backend/lib/foodMoney.js` — add markup resolution (item → restaurant → type default)
  and split `food_subtotal` / `markup_total`; `priceOrder()` returns both.
- `backend/controllers/food/ordersController.js` (`checkout`) — read `menu_items.markup`
  and `merchants.default_markup`; store the new snapshot fields.
- `backend/controllers/food/adminFoodController.js` (`acceptOrder`) — **stop charging the
  restaurant's credit** (or repurpose per D1). Depends on section 7.
- Admin UI `frontend/src/portal/admin/FoodAdmin.jsx` — add **markup** to the item form,
  and **default markup** to the restaurant form.
- Customer UI (`RestaurantPage`, cart, checkout, track) — the menu shows `base + markup`
  as the single item price; the receipt shows `items subtotal + delivery = total`
  (markup is not itemized to the customer unless we choose to).
- `menu_items` public read (`restaurantsController`) — expose the customer price
  (base + markup), not the raw base, so the menu displays the right number.

---

## 7. THE decision needed before implementation — the 300 SAR credit system

The 300 SAR merchant credit limit, the 80% (240) alert, and auto-suspension exist to
**cap how much unpaid margin a restaurant can accrue**. If the **customer** now pays the
markup, the restaurant accrues **no** margin debt — so that whole subsystem loses its
original purpose. We must pick one:

- **Option A — Retire it.** Remove the credit charge on accept, the 300 limit, the 80%
  alert, and auto-suspend. Simplest. (Note: the PRD listed the 300 credit as a
  must-have, so this is a deliberate product reversal.)
- **Option B — Repurpose it as a payout ledger (recommended).** Keep
  `merchant_credit_ledger`, but flip its meaning: each delivered order **accrues what we
  owe the restaurant** (`food_subtotal`); admin records payouts as they settle. Same
  table and admin surface, inverted direction. Preserves an audit trail of money owed.
- **Option C — Keep both.** Customer pays markup **and** we still meter a restaurant
  credit for something else (e.g. a listing/subscription fee). Only if there's a real
  second charge — otherwise it's dead complexity.

Everything else in this doc is ready to build; this is the one branch that changes the
accept flow and the admin "credit" UI. **Confirm A, B, or C and I'll finalize the doc and
implement migration 0015 + the money-engine change.**

---

## 8. Unaffected (stays exactly as audited)

- Money is server-recomputed from DB rows; client totals ignored.
- 30 SAR minimum and 15 km / 10 SAR delivery rule.
- PCI posture: only tokens/txn ids stored; STC Pay manual + cash-on-delivery flows.
- Payment/webhook idempotency and RBAC/RLS.
- The customer still pays a single `total` via the same payment paths — only the
  composition of that total changes.
