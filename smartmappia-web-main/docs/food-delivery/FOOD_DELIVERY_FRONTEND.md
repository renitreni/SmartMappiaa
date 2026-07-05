# SmartMappia — Food Delivery: Frontend Design Brief (for Fable 5)

Design the Food Delivery UI **inside the existing SmartMappia React app** (React 19 + Vite +
Tailwind), matching the current design language (brand orange→red gradients, rounded-2xl cards, the
`PortalShell`/`Card`/`Badge`/`btnPrimary` components in `src/portal/components/ui.jsx`, Lucide
icons). Reuse patterns from the existing rider/driver/admin portals and the marketing `Restaurants`
and `Shop` sections. Everything must be fully responsive (mobile-first; the same build ships as the
Capacitor Android app).

Requirements source: `FOOD_DELIVERY_PRD.md`. API contract: `FOOD_DELIVERY_BACKEND.md`.

---

## 1. The three experiences (routes)
- **Customer** (`/food`, `/food/r/:id`, `/food/cart`, `/food/checkout`, `/food/orders`,
  `/food/track/:code`)
- **Merchant** (`/merchant` — dashboard, orders, menu, finances) — gated `role=merchant`
- **Admin** (extend the existing admin portal with a Food tab)

Gate role routes with the existing `RequireAuth`.

---

## 2. Customer screens
1. **Discovery / Home (`/food`)** — search bar (name), cuisine-category chips, restaurant cards
   (logo, name, cuisine, rating, delivery-fee badge). Empty/loading/error states.
2. **Restaurant menu (`/food/r/:id`)** — header (logo, name, cuisine), category tabs, item cards
   (image, name, price, add button, "unavailable" state). Sticky **cart bar** showing item count +
   subtotal.
3. **Cart (`/food/cart`)** — line items with quantity steppers, subtotal, delivery fee, total.
   **Critical state:** if subtotal < 30 SAR, show a clear inline message ("Add SAR X more to reach
   the 30 SAR minimum") and **disable the Checkout button**. Design the enabled vs disabled states.
4. **Checkout (`/food/checkout`)** — delivery address (map/location), order summary (subtotal +
   10 SAR delivery fee + total), payment method picker (**STC Pay** manual / **Tap** "coming soon").
   STC Pay: show the pay number + a proof-upload control (reuse the payment-proof pattern).
5. **Order tracking (`/food/track/:code`)** — live status stepper (Pending → Preparing → Ready →
   Out for delivery → Delivered), merchant + ETA, contact.
6. **Order history (`/food/orders`)** — past orders, re-order button.

## 3. Merchant screens
1. **Dashboard** — big **credit balance** widget (used / 300 SAR) with color states: normal (<80%),
   **warning at 80% (≥240)**, **suspended at 100% (300)** with an unmistakable banner + disabled
   "accept" ability. Today's orders/revenue tiles.
2. **Orders (live)** — incoming order cards with **Accept / Reject**; when suspended (credit
   exhausted) the Accept button is disabled with an explanatory tooltip/banner. Status controls
   (Preparing → Ready → Out for delivery).
3. **Menu & inventory** — categories + items CRUD; toggle availability; edit price; add photo.
4. **Finances** — credit ledger (charges per order, replenishments), transaction history.

## 4. Admin (Food tab in the existing admin portal)
- System overview (volume, revenue = platform margins, health).
- Merchant management table with credit usage bars + **Suspend / Reactivate / Reconcile** actions.
- Catalog moderation (view/edit any menu).

---

## 5. Error & edge states to design explicitly (the whole point)
- **30 SAR minimum:** cart + checkout show the shortfall and disable payment.
- **Merchant credit 80% warning** and **100% suspension** (merchant dashboard + orders).
- Item unavailable / restaurant closed / outside delivery radius.
- Payment pending / failed / retry.
- Empty states (no restaurants, empty cart, no orders) and loading skeletons.

---

## 6. Design system rules
- Match existing brand: primary orange `#FF7E21`→red gradient; dark `brand-black`; muted greys;
  rounded-2xl cards; bold headings; Lucide icons.
- Reuse `PortalShell`, `Card`, `Badge`, `Spinner`, `btnPrimary`, `Field` from
  `src/portal/components/ui.jsx`. Do not invent a parallel component set.
- Mobile-first, thumb-friendly targets, sticky cart/CTA bars on mobile.
- Currency shown as `SAR 30.00` consistently.
- No emojis in the product UI (project rule).

## 7. Deliverables from Fable
- High-fidelity screens for all customer + merchant screens above (desktop + mobile), including every
  error/empty/loading state.
- A clickable prototype covering the critical path: discover → menu → cart (with the 30 SAR gate) →
  checkout → track; and merchant: receive → accept (with credit gate) → preparing → ready.
- Component specs that map to the existing Tailwind design tokens so implementation is a straight
  build, not a redesign.
