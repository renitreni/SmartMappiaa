# SmartMappia — Food Delivery Service (Product Requirements)

Product requirements for the SmartMappia **Food Delivery** service. This is a new service on the
existing SmartMappia platform (same Supabase project, same auth, same STC Pay / Tap payment
approach as Pick & Drop) with three audiences: **Customer**, **Merchant (restaurant)**, and
**Admin**.

Companion docs (this folder): the Supabase data model in `FOOD_DELIVERY_ERD.md`, the backend build
plan in `FOOD_DELIVERY_BACKEND.md`, the frontend design brief in `FOOD_DELIVERY_FRONTEND.md`, and
the AI build prompts in `FOOD_DELIVERY_PROMPTS.md`.

---

## 1. MVP scope — feature prioritization matrix

| Feature | Category | Priority | Business logic / dependency |
|---|---|---|---|
| User authentication | User portal | Must-have | Secure login (phone/email) required before any order processing |
| Restaurant / menu catalog | Discovery | Must-have | Display active menus, prices, and categories |
| Search & filtering | Discovery | Must-have | Search by restaurant name or cuisine type |
| Shopping cart & checkout | Conversion | Must-have | Must enforce **30 SAR minimum order** validation |
| Secure payment (STC / Tap) | Payment | Must-have | STC Pay & Tap Payments integration for checkout |
| Merchant order dashboard | Operations | Must-have | Real-time portal for vendors to accept/reject orders |
| Order status tracking | Tracking | Must-have | Real-time: Pending → Preparing → Ready → Delivered |
| Delivery fee calculation | Pricing | Must-have | Flat **10 SAR** per 15 km radius (3-month promo) |
| Order history | User portal | Should-have | View past orders for re-order / support |
| Push notifications | Communication | Should-have | Order-status updates to users/merchants |
| Rating & reviews | Engagement | Could-have | Feedback on food quality / speed |
| Promocodes / discounts | Marketing | Could-have | Percentage or fixed-amount discounts |
| Advanced analytics | Admin | Won't-have (Phase 2) | Predictive / behavioral modeling |

### Implementation strategy
- **Priority 1 — Critical path (Must-haves):** non-negotiable; without these the platform cannot
  process a single order. Sole focus of the first sprint.
- **Priority 2 — Reliability (Should-haves):** order history + push notifications, once the core
  flow is stable.
- **Priority 3 — Scalability (Could-haves):** "delight" features; not required for first revenue.

---

## 2. Product requirements

### Functional (Customer)
- **Authentication:** secure sign-up/login via email or mobile number.
- **Menu & discovery:** browse restaurant listings, detailed menu views, and search by cuisine or
  restaurant name.
- **Shopping cart:** persistent cart with automated validation enforcing a **minimum order of
  30 SAR** before checkout can proceed.
- **Checkout & payment:** secure processing via STC Pay and Tap Payments.
- **Order tracking:** real-time status (Pending, Preparing, Ready, Delivered).

### Functional (Merchant)
- **Order management:** real-time dashboard to receive, accept, or reject incoming orders.
- **Inventory & menu management:** instantly update food availability, pricing, and descriptions.

### Non-functional
- **Performance:** high-speed responsiveness; target page load under **3 seconds**.
- **Responsiveness:** fully responsive UI/UX across desktop and mobile.
- **Scalability:** support concurrent user + merchant sessions without latency degradation.
- **Security & compliance:**
  - End-to-end encryption for passwords and sensitive personal data.
  - Full compliance with **SDAIA** (Saudi Data & AI Authority) and **PCI-DSS** for financial
    transactions.
  - **No storage** of sensitive financial credentials on internal servers — rely on third-party
    secure payment gateways.

---

## 3. User stories

**Customer**
- Browse restaurants and view menus to select a meal.
- Add items to cart and checkout, ensuring the order meets the **30 SAR minimum**.
- Pay securely via STC Pay or Tap Payments to complete the transaction instantly.
- Track order status in real time.

**Merchant**
- Update menu items and pricing so customers see accurate availability.
- Manage operational credit balance to know when to replenish.

**Administrator**
- Monitor merchant credit usage (**300 SAR limit**) to manage risk and service continuity.

---

## 4. Product backlog

| ID | Feature | Priority | Description |
|---|---|---|---|
| PB-01 | User authentication | High | Secure sign-up/login for customers and merchants |
| PB-02 | Food menu management | High | Merchant create/edit food categories and items |
| PB-03 | Order validation logic | High | Cart enforcement of the **30 SAR minimum** (server-side) |
| PB-04 | Payment integration | High | STC Pay + Tap Payments |
| PB-05 | Merchant order dashboard | High | Real-time accept/reject of food orders |
| PB-06 | Credit monitoring system | High | Real-time tracking of the **300 SAR** merchant credit limit |
| PB-07 | Delivery fee calculation | High | Automated **10 SAR** fee within 15 km |
| PB-08 | Order tracking status | Medium | Pending, Preparing, Ready, Delivered |
| PB-09 | Threshold alerts | Medium | Notify when merchant credit reaches **80%** |
| PB-10 | Service suspension logic | Medium | Auto-restrict when credit limit is exhausted |

> PB-03 (order validation) and the credit checks **must be enforced server-side** to prevent
> customers/merchants bypassing the 30 SAR minimum or 300 SAR limit.

---

## 5. User journey map

| Stage | User/merchant action | System touchpoint | Business rule |
|---|---|---|---|
| 1. Discovery | Search restaurants / browse cuisines | Home / search | Show active, available restaurants by location |
| 2. Selection | Add items to cart | Product detail | Track items, quantity, subtotal |
| 3. Validation | Proceed to checkout | Cart checkout | **If subtotal < 30 SAR, disable Checkout** |
| 4. Payment | Choose STC Pay / Tap, confirm | Secure gateway | 3rd-party API; real-time transaction status |
| 5. Acceptance | Merchant reviews order | Merchant dashboard | **If merchant credit ≤ 0, cannot accept** |
| 6. Fulfillment | Merchant sets Preparing → Ready | Status tracker | Real-time push to customer + admin |
| 7. Delivery | Order delivered; user confirms | Delivery interface | Settle **10 SAR** delivery fee; mark complete |

> Design blueprint: account for **all error states**, especially the 30 SAR minimum and the 300 SAR
> merchant credit limit, before writing code — define these rules now to avoid rework.

---

## 6. Information architecture / sitemap

### Customer app (ordering)
- **Authentication** — sign-up / login
- **Home / discovery** — restaurant listings, search bar, cuisine categories
- **Restaurant menu** — product display, item details, customization
- **Cart & checkout** — order summary + persistent 30 SAR minimum validation
- **Payment & tracking** — STC Pay / Tap gateway + real-time status

### Merchant portal (operations)
- **Merchant dashboard** — live 300 SAR credit balance + order status
- **Order manager** — accept / reject incoming orders
- **Menu & inventory** — update availability, prices, descriptions
- **Finances** — transaction history + credit usage

### Admin portal (oversight)
- **System overview** — total volume + platform health
- **Merchant management** — oversight of restaurants, credit-limit monitoring, manual suspension
- **Financial reconciliation** — audit credit-utilization + earnings
- **Catalog & content management** — full CRUD for menus, items, prices, photos

---

## 7. Monetization / pricing rules

### Customer-facing
- **Minimum order:** every transaction must be **≥ 30 SAR** (orders below are blocked).
- **Delivery fee:** flat **10 SAR** within a 15 km radius. **Promotional rate — first 3 months only.**

### Platform margin (per item)
| Category | Margin per item |
|---|---|
| Meals & packages | 5 SAR |
| Drinks, desserts & add-ons | 3 SAR |

### Merchant financial operations
- **Operational credit limit:** each merchant operates under a **300 SAR** credit limit.
- **Threshold alert:** automated notification to merchant + admin when usage reaches **80% (240 SAR)**.
- **Service suspension:** automatically disable the merchant's ability to accept new orders on
  reaching the **300 SAR** limit, until reconciled.

### Payment gateway logic
- All transactions route through **STC Pay** and **Tap Payments**.
- **No sensitive financial credentials stored** on SmartMappia servers — processing happens inside
  the PCI-DSS-compliant gateway environments.

> These rules are functional requirements: the **30 SAR minimum** and **300 SAR credit limit** must
> be validated **server-side** to prevent circumvention.

---

## 8. Privacy & data handling (SDAIA / PCI-DSS)

1. **Data minimization & consent** — collect only what's needed to fulfill an order (name, phone,
   delivery address). No secondary data without explicit, granular consent. Privacy-by-design: no
   permission requested unless a feature needs it.
2. **Encryption** — **TLS 1.3 (HTTPS)** in transit; **AES-256** at rest for sensitive data.
3. **Payment data (critical)** — **never store raw payment data** (card numbers, CVV, expiry).
   Rely on STC Pay / Tap for processing; store only the **transaction ID / payment token** to link
   an order to its payment status (PCI-DSS compliant by design).
4. **Access control (RBAC)** — least privilege: developers get non-production/sanitized data only;
   admin/ops get only what's needed for troubleshooting. **Audit-log** all access to sensitive data
   (immutable trail of who accessed what, when).
5. **Retention & disposal** — automated deletion policy for stale accounts/orders past the legal
   retention period, unless mandated otherwise.

> Treat all data-handling requirements as mandatory; report any security/data-handling improvement
> for full SDAIA compliance.

---

## 9. Analytics & event tracking

Event names use lowercase_with_underscores for consistency.

| Category | Event | Trigger | Parameters |
|---|---|---|---|
| Discovery | `view_menu` | User opens a restaurant profile | `restaurant_id, cuisine_type` |
| Engagement | `add_to_cart` | User adds an item | `item_id, price, quantity` |
| Conversion | `checkout_attempt` | User clicks checkout | `order_total, failure_reason` (if < 30 SAR) |
| Payment | `payment_success` | Gateway callback received | `transaction_id, payment_method, amount` |
| Ops | `merchant_order_accept` | Merchant clicks Accept | `order_id, merchant_id` |
| Ops | `credit_limit_warning` | Credit usage hits 80% | `current_usage, merchant_id` |
| Ops | `service_suspended` | Credit limit reached (300 SAR) | `final_balance, merchant_id` |

---

## 10. Hard business rules (must be server-enforced)
1. Cart subtotal **≥ 30 SAR** before payment is allowed.
2. Merchant **credit balance > 0** before an order can be accepted.
3. **10 SAR** delivery fee within 15 km (promo: first 3 months).
4. Per-item platform margin: **5 SAR** (meals/packages), **3 SAR** (drinks/desserts/add-ons).
5. Merchant credit **80% alert (240 SAR)**; **auto-suspend at 300 SAR**.
6. Payments via STC Pay / Tap only; store token/transaction id, never raw payment data.
