# Ask the Boss — Open Decisions (Food Delivery)

One-page briefs for decisions only the boss should make. Each item is written so it can
be read cold, decided, and exported to PDF. Once a decision is made, record it here and
move the detail into the relevant spec (`FOOD_PRICING.md`, `FOOD_DELIVERY_PRD.md`).

---

## Decision 1 — What happens to the 300 SAR restaurant "credit" system?

**Status:** OPEN. Blocks the new pricing implementation.
**Date raised:** 2026-07-06.

### Background (plain terms)

We are changing how food is priced. The new rule (already agreed):

- The admin sets each dish's **base price** (the restaurant's money).
- The admin adds a **markup** on top (SmartMappia's money) — set per dish, or a default
  per restaurant.
- The **customer pays** base + markup + SAR 10 delivery. We keep the markup.

Example: a SAR 56 food cart + SAR 13 markup + SAR 10 delivery = **SAR 79** paid by the
customer. The restaurant is owed the SAR 56; we keep SAR 13 (+ delivery).

### The conflict

The current system gives each restaurant a **300 SAR credit limit** (with an 80% warning
at 240 and auto-suspension at 300). That exists because, in the **old** model, the
restaurant **owed us** the markup, so we capped how much they could owe before paying up.

In the **new** model the **customer** pays the markup directly to us. So the restaurant
owes us nothing per order — in fact **we now owe the restaurant** their food money. The
300 SAR credit limit therefore no longer has a purpose.

### The options

| Option | What it means | Pros | Cons |
|---|---|---|---|
| **B (recommended)** | **Repurpose** the same system as a **payout ledger**: each delivered order records what **we owe the restaurant**; admin marks payouts as settled. | Keeps a clean, auditable money trail; reuses the screens we already built. | Small rework to flip the meaning (owed vs. owes). |
| **A** | **Retire** it: remove the 300 limit, the alert, and auto-suspend entirely. | Simplest to build. | We track what we owe restaurants **off-system** (e.g. a spreadsheet). |
| **C** | **Keep it for a different charge** — e.g. a monthly listing/subscription fee restaurants pay us. | Retains a real credit limit if such a fee exists. | Only makes sense if we actually charge restaurants a separate fee. |

### Recommendation

**Option B.** It keeps an auditable record of money owed to each restaurant, reuses the
existing admin screens, and throws away the least. Choose A only if payouts will be
handled entirely outside the system; choose C only if restaurants will pay a separate
recurring fee.

### Decision (to be filled in)

- Chosen option: ______
- Decided by: ______   Date: ______
- Notes: ______

---

## How to add another item here

Copy the block below and fill it in:

```
## Decision N — <short title>
Status: OPEN | DECIDED
Background: <plain-terms context>
The conflict / question: <what must be decided and why>
Options: <table or list with pros/cons>
Recommendation: <your pick + why>
Decision: chosen ___ / by ___ / date ___
```
