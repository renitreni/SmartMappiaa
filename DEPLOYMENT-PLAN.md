# SmartMappia Docker Deployment Plan — Production Cutover

Target commit: `ce7c36b` ("Drop Supabase…") on branch `full`, already pushed to origin.
Server: `root@187.127.100.178` (srv1777854, Ubuntu, Docker 29.6 + Compose v5.1.4, 83 GB free disk).

---

## 1. Current production layout (verified on server)

| Piece | Where | Notes |
|---|---|---|
| Web frontend | nginx static, `smartmappia.com` → `/opt/SmartMappiaa/smartmappia-web-main/frontend/dist` | SPA fallback in place; TLS via Certbot |
| API | PM2 process `smartmappia-api` → `127.0.0.1:4000` | Runs `backend/server.js` from checkout at old commit `e96b2c0` |
| API proxy | nginx `api.smartmappia.com` → `127.0.0.1:4000` | Has SSE-safe `location = /api/events` block (buffering off, 75 s timeouts) and `client_max_body_size 12m` — **keep these** |
| Database | Supabase cloud project `wwaofiklnlkvdimfajgq` | API uses `SUPABASE_URL` + service-role key; **no DB password on the server** |
| Storage | Supabase Storage buckets (payment proofs, avatars, merchant images, driver docs) | Frontend build has `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` — it talks to Supabase directly |
| Routing | Google Routes API via backend `/api/route` (OSRM already retired in code) | Legacy `osrm` container still runs on `127.0.0.1:5000` — unused by current code, safe to stop after cutover |
| Neighbors | asclepius.sbs, thejobconnections.xyz, rozanatravels, yaramay.online, MariaDB on the same box | Must not be disturbed; compose stack must not bind host ports except the API |

## 2. New stack (from repo `docker-compose.yml`)

- `postgres` (16-alpine) — private, healthchecked, init script creates `smartmappia_app` role
- `redis` (7-alpine) — private, appendonly
- `minio` (librefs S3) — private, holds payment proofs / driver docs / merchant images / avatars
- `realtime` (node) — internal on `:4100`, Redis-backed, publishes via `REALTIME_PUBLISH_TOKEN`
- `migrate` + `seed-reference` — one-shot containers, run baseline migrations + reference seed
- `api` — exposes `:4000` internally; needs `backend/.env`
- `frontend` — builds Vite app, serves on `:8080` (not needed for our cutover — see §5)

Baseline migrations: `backend/migrations/postgres/0001–0007`. No Supabase anywhere; new auth is app-owned (`app_users` with scrypt hashes, `app_sessions`, password-reset tables).

## 3. What changes at cutover (endpoint compatibility)

All public endpoints keep their shape (`/api/…`), and nginx keeps both hostnames, so URLs stay stable. The real changes:

1. **Frontend must be rebuilt and redeployed together with the API.** The current production frontend has Supabase keys compiled in (direct Supabase auth/storage calls). The new frontend no longer uses them (auth via API, realtime via `/api/events`). Mixing old frontend + new API breaks login. Rebuild `dist` from `ce7c36b` with `VITE_API_BASE=https://api.smartmappia.com` and **no Supabase vars**.
2. **Auth data moves from Supabase Auth to `app_users`.** Password hashes: Supabase GoTrue = **bcrypt**, new backend = **scrypt** — not copyable. See decision D2.
3. **Files move from Supabase Storage to MinIO**, served via the API media gateway `/api/files/public/…` (public buckets) and signed URLs (private buckets). The repo already ships `scripts/migrate-public-media-urls.js` (dry-run, `--apply`) to rewrite persisted URLs.
4. **Password-reset emails now come from the app SMTP** (was Supabase Auth). Server `.env` currently has **no SMTP keys** — credentials must be procured before cutover.
5. `/api/events` SSE block and `client_max_body_size` in nginx carry over unchanged.

## 4. Data migration approach

**Status: tooling implemented and smoke-tested (see §10).**

Old schema differs from the new baseline (old tables FK to `auth.users`; new baseline is standalone, zero `auth.users` references). A raw `pg_dump` restore will **not** fit — an app-level ETL is required regardless of export path.

**Export — decision D1:** `backend/scripts/supabase-export.sql` (psql `\copy`, one CSV per table + `auth_users.csv` with an explicit GoTrue column list). Run from any machine with psql:

```sh
mkdir -p csv && cd csv
psql "$SUPABASE_DB_URL" -f backend/scripts/supabase-export.sql   # writes CSVs into ./csv
scp -r csv root@187.127.100.178:/opt/SmartMappiaa/import/
```

`SUPABASE_DB_URL` is the direct Postgres connection string from the Supabase dashboard (pooler host `:6543` with `?pgbouncer=true&connection_limit=1` also works). The old and new schemas are **column-for-column identical** for all 43 public tables (verified by diff), so no table restructuring — only the `auth.users` → `app_users` mapping, which keeps UUIDs so every FK stays valid.

**Transform & load:** `backend/scripts/import-supabase.js` (against the target DB, e.g. `docker compose exec api node scripts/import-supabase.js import --dir /import/csv`):

1. `auth_users.csv` → `app_users`, same UUIDs; skips deleted/anonymous/no-email rows (reported); `banned_until` → `disabled_at`; empty passwords get an unusable random scrypt hash (account stays locked until password reset). **bcrypt hashes are imported as-is** and handled by the verify-shim (D2).
2. Each `<table>.csv` → `import_staging.<table>` (typed via `LIKE public.<table>`), then `INSERT … ON CONFLICT DO NOTHING` under `session_replication_role = replica` — idempotent, safe to re-run.
3. Built-in tripwire: refuses to import once any `app_sessions` row exists (sessions only appear when the new API serves live logins).
4. `verify` (count comparison + orphan check, no writes) and `cleanup` (drops `import_staging`) subcommands.
5. Storage objects: download each bucket from Supabase Storage (service key) → upload into MinIO **preserving object keys** after `node scripts/setup-buckets.js` (idempotent), then `node scripts/migrate-public-media-urls.js --apply` rewrites stored public URLs to `${PUBLIC_API_BASE}/api/files/public/…`.

## 5. Target topology (minimal-change, two origins kept)

Keep the existing nginx layout — only the API upstream changes. This preserves CORS config, TLS, and every public URL.

```
smartmappia.com          → nginx static dist (rebuilt from ce7c36b)      [unchanged config]
api.smartmappia.com      → nginx → 127.0.0.1:4001 (docker api)           [was 127.0.0.1:4000 PM2]
                           /api/events SSE block kept
compose network          → postgres, redis, minio, realtime, api          [private, no host ports]
```

New checkout at `/opt/SmartMappiaa/smartmappia-docker` (old checkout left untouched for instant rollback). API published as `127.0.0.1:4001:4000` via a `docker-compose.prod.yml` override (base file has only `expose`). The compose `frontend` service is **not used** in production — the host nginx keeps serving static `dist`, which also matches `VITE_API_BASE=https://api.smartmappia.com`.

## 6. Env plan

**Compose-level `.env`** (new): `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `MINIO_ROOT_USER/PASSWORD` (fresh strong values), `REALTIME_PUBLISH_TOKEN` (random).

**`backend/.env`** (adapted from existing, copy then edit):
- Remove: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SESSION_ENCRYPTION_KEY`, `SESSION_SQLITE_PATH`, `MAPBOX_SECRET_ACCESS_TOKEN`.
- Add: `APP_SIGNING_KEY` (random 32+ bytes), `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`MAIL_FROM` (**decision D3** — procure credentials).
- Keep as-is: `CORS_ORIGINS`, `PAYMENT_MODE=stcpay_manual`, STCPay vars, `VAPID_*`, `ADMIN_EMAILS`, `GOOGLE_MAPS_SERVER_KEY`, `TAP_*`, `PUBLIC_WEB_URL`, `PUBLIC_API_BASE`, `SHOP_ENABLED`, payment-proof TTL/size vars.
- `DATABASE_URL`, `OBJECT_STORAGE_*`, `REALTIME_*`, `PORT` are injected by compose — do not set in `.env`.

## 7. Cutover sequence

**Phase 0 — Pre-flight (needs input)**
- D1: Supabase DB password (or approve REST export).
- D2: password strategy (recommend bcrypt verify-shim — see below).
- D3: SMTP credentials for transactional mail.
- Fresh `pg_dump`-style safety: export counts from Supabase; snapshot the old checkout.

**Phase 1 — Stage the stack (no downtime)**
1. `git clone` to `/opt/SmartMappiaa/smartmappia-docker`, checkout `ce7c36b`.
2. Write compose `.env`, `backend/.env`, `docker-compose.prod.yml` (port 4001 override).
3. `docker compose -f docker-compose.yml -f docker-compose.prod.yml build` then `up -d postgres redis minio realtime`; `migrate` + `seed-reference` run to completion; run `setup-buckets.js` via a one-shot `docker compose run --rm api node scripts/setup-buckets.js`.

**Phase 2 — Migrate data (old site still live)**
4. Export Supabase (per D1); run the ETL into the staged DB; copy storage objects into MinIO; run `migrate-public-media-urls.js --apply`.
5. Re-run row-count verification.

**Phase 3 — Smoke test (private)**
6. On the server: `curl 127.0.0.1:4001/health`, `/api/route`, login flow for a seeded test user, an authenticated endpoint per domain (rides, food, shop, ledger, admin), `/api/events` SSE stream, a file upload + signed download, password-reset email (SMTP).

**Phase 4 — Cutover (minutes of downtime)**
7. Rebuild frontend `dist` from `ce7c36b` with production build vars (no Supabase keys); `nginx -t && systemctl reload` isn't needed for static, but verify the site loads.
8. Flip `api.smartmappia.com` upstream `4000 → 4001`, `nginx -t && systemctl reload nginx`.
9. Verify from outside: health, login (post-password-strategy), key endpoints, SSE, web app loads.

**Phase 5 — Rollback & cleanup**
- Rollback (if needed): flip nginx back to `4000`, `pm2 restart smartmappia-api`. Old stack untouched until Phase 6.
- After a stable window (recommend 7 days): `pm2 stop smartmappia-api && pm2 delete smartmappia-api` (keep ecosystem file archived), stop the legacy `osrm` container, archive old checkout to `/opt/SmartMappiaa/legacy-smartmappia-web-main.tar.gz`, set up a nightly `pg_dump` cron of the compose Postgres + MinIO volume backup.

## 8. Risks & decisions

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Supabase export path | A: DB password → pg_dump (fast, complete) / B: REST export with service key (no password needed) | A; B is fallback |
| D2 | Password hash migration (bcrypt → scrypt) | ~~A: bcrypt verify-shim~~ **IMPLEMENTED** — `lib/passwords.js` verifies `$2a$/$2b$` via `bcryptjs` and `authController.login` re-hashes to scrypt on first successful login; non-scrypt formats still rejected | Done; track re-hash progress, remove bcrypt after the tail drains |
| D3 | SMTP | Any provider (host's own mail, SendGrid, Resend, Gmail app password) | Procure before Phase 1 |
| R1 | Old frontend during staging | Old frontend keeps using Supabase until cutover — both systems run in parallel; last write wins goes to Supabase until the nginx flip | Keep staging strictly read-only against the new DB until cutover |
| R2 | Long bcrypt tail | After D2-A, track re-hash progress; remove shim in a later release | — |
| R3 | MinIO public images | Public bucket served only through the API gateway — no extra host port | Already the design |

## 9. Definition of done

- `api.smartmappia.com` served by the Docker API (verify via response header/container log).
- All smoke endpoints green from an external client; web app login, ordering, tracking, admin dashboards functional.
- Zero references to Supabase in server envs; Supabase project can be paused.
- Nightly DB + object backups in place; rollback artifacts archived.

## 10. Implementation log

### Phases 2–4 summary

### Phase 2 — SKIPPED per owner decision (2026-10-16)

No Supabase data/storage migration. Production starts fresh on the standalone stack; the old Supabase project (`wwaofiklnlkvdimfajgq`) remains the only copy of pre-cutover accounts/orders/files. The ETL tooling stays in the repo should a retroactive import ever be wanted.

### Phase 4 — cutover complete (2026-10-16) ✅

- Frontend `dist` rebuilt from the Drop-Supabase code (no active Supabase deps; remaining "supabase" strings are passive legacy-URL handling) and deployed to the new checkout.
- nginx: `smartmappia.com` root → new dist; `api.smartmappia.com` upstream → `127.0.0.1:4001` (docker). Reloaded after `nginx -t`.
- Verified publicly: api 200, web 200, `/login` 200, prynz admin login 200 through `api.smartmappia.com` with the session row landing in the docker Postgres.
- Decommissioned: PM2 `smartmappia-api` stopped/deleted (`pm2 save`), legacy `osrm` container stopped, old Rizzkkk checkout archived to `/opt/SmartMappiaa/archive/smartmappia-web-main-pre-cutover-20261016.tar.gz` (contains old env secrets — keep restricted) and removed; rsync backup removed. Port 4000 free.
- Seed accounts live on production: super admin `ferdzsabado@smartmappia.com`, admins `ferdz@`/`prynz@smartmappia.com`, test user/driver (credentials with owner).
- REMAINING GAPS: SMTP not configured (password-reset emails fail — D3); GitHub deploy key not registered (deploys flow via `git push server-deploy full`); the archived Rizzkkk PAT should be rotated; nightly DB/object backups not yet scheduled.

- Commit `affa193` (cutover tooling) + plan updates pushed to `renitreni/SmartMappiaa` (canonical remote; HEAD `b1eb157`).
- NOTE: the server's old checkout tracks `github.com/Rizzkkk/SmartMappiaa` — a different repo without these commits. Server has no GitHub key, so the branch is pushed from local to a bare repo on the server (`git remote add server-deploy root@187.127.100.178:/opt/SmartMappiaa/smartmappiaa.git`) and the deploy dir is a real `git clone` of it, with `origin` set to `git@github.com:renitreni/SmartMappiaa.git` for when a deploy key is registered. Also: a live GitHub PAT is embedded in the old checkout's origin URL — rotate it.
- Deployed to `/opt/SmartMappiaa/smartmappiaa-docker/smartmappia-web-main`; previous rsync copy kept at `/opt/SmartMappiaa/smartmappiaa-docker-rsync-backup` until cutover is verified.
- Re-clone kept the same compose project name, so the existing Docker Postgres/Redis/MinIO **volumes were reused — all data preserved** (7 migrations, 4 buckets, 48 tables verified after the swap).
- `.env` (compose) and `backend/.env` written server-side with on-server-generated secrets; Supabase/session keys stripped; `APP_SIGNING_KEY` added. **SMTP keys still missing (D3)** — password reset emails will fail until supplied.
- Stack up: postgres/redis/minio/realtime healthy; API published on `127.0.0.1:4001`.
- Smoke: root 200, unknown login 401 (DB wired), `/api/route` 400, `/api/events` 403 (auth-guarded, reachable), CORS allows `https://smartmappia.com`, `app_users` empty, `app_sessions` 0.
- nginx NOT flipped — production still served by PM2 on 4000. Old Rizzkkk checkout MUST stay until cutover (it is the live site).

### Original implementation

- **bcrypt verify-shim (D2):** `backend/lib/passwords.js` + transparent rehash in `authController.login`; new dep `bcryptjs` (pure JS, safe for alpine builds). Tests in `test/passwords.test.js`.
- **ETL importer:** `backend/scripts/import-supabase.js` (`import` / `verify` / `cleanup`) + `backend/scripts/supabase-export.sql` (psql `\copy` generator). New dep `pg-copy-streams`. npm aliases `import:supabase*`.
- **Prod compose overlay:** `docker-compose.prod.yml` — publishes API as `127.0.0.1:4001:4000`; run with `-f docker-compose.yml -f docker-compose.prod.yml`.
- **Smoke-tested locally:** baseline migrations + seed on throwaway Postgres 16 → synthetic 5-user `auth_users.csv` + `profiles.csv`/`merchants.csv` → import, re-run (idempotent: 0 inserted), bcrypt verify on imported hash, banned→disabled mapping, live-traffic tripwire (refuses with 1 session row), cleanup. Full suite **217/217 green**.
