# Smart Mappia — Documentation

Local-only docs (the public GitHub repo is code-only). No emojis (project rule).

The documentation has been consolidated into two living documents:

| Doc | What it covers |
|---|---|
| **[SMARTMAPPIA.md](SMARTMAPPIA.md)** | The platform master reference: both services (Pick & Drop + Food Delivery), architecture, roles & auth, dispatch + auto re-dispatch, payments, storage, the database & ERD, environment, local setup, deployment/hosting/Android, security, the admin runbook, testing, changelog, and roadmap. |
| **[food-delivery/FOOD_DELIVERY.md](food-delivery/FOOD_DELIVERY.md)** | The complete Food Delivery deep-dive: product scope, business rules, onboarding & owner accounts, screens, order flow, dispatch, payments, the pricing/payout-ledger model, schema & migrations, the API, image uploads, the tracking UI, ops runbook, and QA plan. |

## Migrations
Runnable SQL lives in [`../backend/migrations/`](../backend/migrations/) (`0001`–`0016`; `0017`
pending). Run in order in the Supabase SQL Editor (**skip `0004`** in production) and verify with
`cd backend && npm run check:migrations`.

## Archive
The previous ~29 documents (two DEMO playbooks, the Pick & Drop docs, the food PRD/ERD/BACKEND/
FRONTEND/HANDBOOK/STATUS/PRICING/AUDIT/PROMPTS, HOSTING/PILOT/TESTING, the deployment log, the
security checklist, the full DB ERD, etc.) are preserved verbatim under **[archive/](archive/)**.
They are historical — where they disagree with the two docs above, the docs above win.
