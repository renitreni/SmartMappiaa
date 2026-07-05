# Production docs — index

Local-only planning/runbook docs for taking Smart Mappia from the pilot to production.
No emojis (project rule).

Start here: **[PICK_AND_DROP.md](PICK_AND_DROP.md)** — the single feature doc (status, build order,
driver verification, mobile app, maps/routing, env vars, database summary). The docs below are the
operational runbooks and reference.

## Documents

| Doc | Purpose |
|---|---|
| [PICK_AND_DROP.md](PICK_AND_DROP.md) | Single source of truth for the feature: status, build order, driver KYC, Capacitor APK, maps/routing + Google pricing, env vars (Cloud vs self-host), DB summary. |
| [ANDROID_APP_GUIDE.md](ANDROID_APP_GUIDE.md) | For the Android developer: Capacitor build, native geolocation/push, backend connection, payments (STC Pay + Tap), full API reference. |
| [DEPLOYMENT_LOG.md](DEPLOYMENT_LOG.md) | Canonical record of the production deploy (VPS, Supabase, Nginx, OSRM) + exact commands. |
| [SECURITY_TODO.md](SECURITY_TODO.md) | Full security hardening list + the 1 July 2026 audit pass (RLS, rate limits, IDOR, the anon-key finding). |
| [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) | The go-live gate: the few flags/steps to flip before real launch. |
| [SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md) | Runbook: move off the Vercel-marketplace Supabase to a standalone Pro project. |
| [APP_BACKEND_UPDATES.md](APP_BACKEND_UPDATES.md) | How app/backend updates work post-launch; stable-domain = no rebuilds. |
| [db/DATABASE_ERD.md](db/DATABASE_ERD.md) | Full entity-relationship reference (column-level, enums, RLS, migration provenance). |
| [../HOSTING.md](../HOSTING.md) | Hostinger stack (VPS + OSRM + Nginx) and deployment checklist. |
| `backend/migrations/0005…0008_*.sql` | Forward migrations (apply on the standalone Supabase). |

## Status at a glance (see PICK_AND_DROP for detail)

- Pick & Drop (web) — **LIVE** (smartmappia.com + api.smartmappia.com)
- Payment — manual STC Pay + admin verify **LIVE**; online gateway (Tap) deferred (flag off)
- Driver verification (KYC) — **LIVE** (upload + admin review + auto-approve gate)
- Data collection / analytics — basic Reports + CSV done
- Notifications — web done; device-token endpoints live; native push (FCM) todo
- Hostinger + OSRM — **LIVE** (self-hosted, proxied at /api/osrm)
- Supabase (standalone) — done
- Capacitor Android app — todo (see ANDROID_APP_GUIDE.md)
- Security / launch gates — in progress (rotate service_role, remove test accounts)
