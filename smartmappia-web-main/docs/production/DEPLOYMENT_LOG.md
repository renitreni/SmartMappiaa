# Smart Mappia — Production Deployment Log (Hostinger)

Living record of the actual production deployment. Companion to
[HOSTING.md](../HOSTING.md) (stack plan), [SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md),
and [PICK_AND_DROP.md](PICK_AND_DROP.md). No secrets are stored here — keys/tokens/passwords
live only in server `.env` files and the respective dashboards.

Started: 1 July 2026. Status: in progress (backend deploy).

---

## Environment facts

### VPS (Hostinger)
- Plan: **KVM 2** — 2 vCPU / 8 GB RAM / 100 GB disk / 8 TB bandwidth.
- OS: **Ubuntu 24.04.4 LTS**. Hostname: `srv1777854.hstgr.cloud`.
- Public IPv4: **187.127.100.178**. Access: `ssh root@187.127.100.178` (root).
- Owned by the **boss's** Hostinger account (NOT the account that holds the API token).
  => the Hostinger MCP cannot manage this VPS; all VPS work is done over SSH / hPanel Terminal.
- Pre-installed: **git**, **Docker + Docker compose**. Docker Manager available in hPanel.

### Domain
- `smartmappia.com` on the **user's** Hostinger account, active (expires 2027-06-14).
  => the Hostinger MCP token CAN manage this domain's DNS (that's how we point records).

### Supabase
- New **standalone** project (Stage 1 done). URL + anon + service_role keys obtained.
- Deferred: rotate the service_role key (was previously exposed as a VITE_ var) — see
  SECURITY_TODO. Not urgent since the new project uses the correct anon key in the frontend.

### Repo
- GitHub: `https://github.com/Rizzkkk/SmartMappiaa` (public), branch **`full`**.
- App path inside the repo: `smartmappia-web-main/backend` and `.../frontend`.

---

## Deployment approach (decided)
- **Paste route:** commands are run in the hPanel **Terminal** / SSH by the user; Claude
  writes each command/config. (MCP has no shell-exec, and the VPS is on the boss's account.)
- App runtime: **Node + PM2**, behind **Nginx** reverse proxy, **Certbot** for HTTPS.
- **OSRM** self-hosted via Docker (later stage) with a backend `/api/route` proxy.
- **DNS** done by Claude via the Hostinger MCP (domain is on the user's account).

---

## Progress log

### Done
- Hostinger MCP connected (VPS + DNS + Domains). Note: the `npx` launch shipped a broken
  MCP SDK; fixed by global-installing `hostinger-api-mcp` and pointing `.mcp.json` at
  `node <installed script>`. Token stored only in `.mcp.json` (gitignored).
- Confirmed VPS specs + that git/Docker are pre-installed (recon step).
- **Installed on the VPS:** Node 20, Nginx, Certbot (+ python3-certbot-nginx), PM2 (7.0.3).

### Done (continued, 1 Jul)
- Cloned repo (branch `full`) to `/opt/SmartMappiaa`; `npm install --omit=dev` (0 vulns).
- Created `backend/.env` (prod Supabase URL + service_role, CORS = prod origins,
  ADMIN_EMAILS, STC Pay number 0553476619, AUTO_VERIFY off, PAYMENT_MODE=stcpay_manual).
- Started with PM2 (`smartmappia-api`, online); health = `db:connected, testMode:false`.

### DNS finding (I cannot automate DNS with the current token)
- `smartmappia.com` nameservers = `helios/aster.dns-parking.com` (Hostinger DNS), but the
  zone is under the **boss's** account — the token's account returns "does not own" / "not
  found" for DNS + domain details. So DNS must be edited in the **boss's hPanel** (or via a
  boss-account token). Domain currently PARKED at `2.57.91.91`; `api` subdomain does not exist.
- Records to add (boss hPanel -> Domains -> smartmappia.com -> DNS zone):
  - `A  api  -> 187.127.100.178`  (backend/API) [now]
  - later: `A @` and `A/CNAME www` for the frontend.

### Done (continued, 1 Jul — backend LIVE)
- DNS: `A api -> 187.127.100.178` added (authoritative + Google resolve).
- Deployed KYC + notifications code (git pull + npm i + pm2 restart).
- Nginx reverse proxy `api.smartmappia.com -> 127.0.0.1:4000`; Certbot HTTPS + HTTP->HTTPS redirect.
- Verified: `https://api.smartmappia.com/api/health` = ok / db connected. **Backend is production-live.**

### In progress — Stage 4 (frontend)
- Build frontend on the VPS with prod env (real ANON key), serve `dist/` via Nginx for
  `smartmappia.com` + `www`, add `A @` + `A www` DNS, Certbot HTTPS.
- Remaining after: self-host OSRM (Stage 3), KYC end-to-end test, launch gates.

### Remaining
1. Create `/opt/SmartMappiaa/smartmappia-web-main/backend/.env` (prod values):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PORT=4000`,
   `AUTO_VERIFY_STCPAY_TEST_MODE=false`, `PAYMENT_MODE=stcpay_manual`,
   `CORS_ORIGINS=https://smartmappia.com,https://www.smartmappia.com`,
   `ADMIN_EMAILS=<real>`, `PAYMENT_PROOF_BUCKET=payment-proofs`,
   `SMART_MAPPIA_STCPAY_NUMBER=<real>`, commission/fee.
2. Start backend: `pm2 start server.js --name smartmappia-api`, `pm2 save`, `pm2 startup`.
   Verify `curl localhost:4000/api/health` => `db:connected`, `testMode:false`.
3. Seed admin on the new DB (`npm run seed:admin` with real ADMIN_SEED_* creds).
4. Nginx: reverse proxy `api.smartmappia.com` -> `127.0.0.1:4000`; add
   `app.set('trust proxy', 1)` in `backend/app.js` for correct rate-limit IPs.
5. DNS (Claude via MCP): A record `api.smartmappia.com` -> 187.127.100.178 (and the apex/www
   for the frontend). Confirm the IP before writing.
6. HTTPS: `certbot --nginx` for the api (and frontend) hostnames.
7. OSRM: Docker with the Saudi extract + `osrm-routed`; backend `/api/route` proxy to
   `127.0.0.1:5000`; set `VITE_OSRM_BASE` accordingly.
8. Frontend: build with prod env (`VITE_API_BASE`, `VITE_SUPABASE_URL`, real **anon** key,
   `VITE_OSRM_BASE`, `VITE_TAP_ENABLED=false`); serve static via Nginx; DNS for the apex/www.
9. Launch gates (see LAUNCH_CHECKLIST): revert driver auto-approve in `authController.js`;
   rotate Supabase service_role; rotate seed passwords; confirm CORS/ADMIN_EMAILS.

---

## Commands used (reference)

Install stack (as root):
```bash
apt-get update -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx certbot python3-certbot-nginx
npm install -g pm2
```

Clone + backend deps:
```bash
cd /opt
git clone -b full https://github.com/Rizzkkk/SmartMappiaa.git
cd /opt/SmartMappiaa/smartmappia-web-main/backend
npm install --omit=dev
```

---

## Security to-dos after go-live
- **Revoke the Hostinger API token** used for the MCP once deployment is done.
- **Rotate the Supabase service_role key** (deferred) and update `backend/.env`.
- Repo is **public** — never commit `.env`; keep secrets server-side only.

---

## Canonical end-to-end deploy sequence (what we actually did)

### 1. Supabase (standalone project)
1. Create the project (own account).
2. SQL Editor: run migrations `0001, 0002, 0003, 0005, 0006, 0007, 0008` (SKIP `0004`).
3. Create PRIVATE buckets: `payment-proofs` and `driver-docs`
   (`insert into storage.buckets (id,name,public) values ('driver-docs','driver-docs',false);`).
4. Copy Project URL + **anon** key + **service_role** key.

### 2. VPS backend (Ubuntu, root)
```
apt-get update -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx certbot python3-certbot-nginx
npm install -g pm2
cd /opt && git clone -b full https://github.com/Rizzkkk/SmartMappiaa.git
cd /opt/SmartMappiaa/smartmappia-web-main/backend && npm install --omit=dev
# create backend/.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT=4000,
#   CORS_ORIGINS=https://smartmappia.com,https://www.smartmappia.com, ADMIN_EMAILS,
#   PAYMENT_MODE=stcpay_manual, AUTO_VERIFY_STCPAY_TEST_MODE=false,
#   SMART_MAPPIA_STCPAY_NUMBER, PAYMENT_PROOF_BUCKET=payment-proofs
pm2 start server.js --name smartmappia-api && pm2 save && pm2 startup systemd -u root --hp /root
curl -s http://localhost:4000/api/health
```

### 3. DNS (hPanel DNS zone for smartmappia.com)
- `A  api  -> 187.127.100.178`
- `A  @    -> 187.127.100.178` (replace the parking record)
- `www` stays a CNAME -> `smartmappia.com`

### 4. Nginx + HTTPS for the API
```
# /etc/nginx/sites-available/api.smartmappia.com  ->  proxy / to http://127.0.0.1:4000
ln -sf .../api.smartmappia.com /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
certbot --nginx -d api.smartmappia.com
```

### 5. Frontend (build + host)
```
cd /opt/SmartMappiaa/smartmappia-web-main/frontend
# create frontend/.env: VITE_API_BASE=https://api.smartmappia.com,
#   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (ANON, not service_role),
#   VITE_OSRM_BASE=https://api.smartmappia.com/api/osrm/route/v1/driving, VITE_TAP_ENABLED=false
rm -rf node_modules package-lock.json   # fixes the rolldown native-binary bug on Linux
npm install && npm run build
# /etc/nginx/sites-available/smartmappia.com -> root .../frontend/dist, try_files ... /index.html
ln -sf .../smartmappia.com /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
certbot --nginx -d smartmappia.com -d www.smartmappia.com
```

### 6. Seed accounts (backend dir)
```
sed -i 's|^ADMIN_EMAILS=.*|ADMIN_EMAILS=ferdz@smartmappia.com,raven@smartmappia.com,prynz@smartmappia.com|' .env
pm2 restart smartmappia-api
ADMIN_SEED_EMAIL=<email> ADMIN_SEED_PASSWORD=<pw> npm run seed:admin   # x3
npm run seed:user && npm run seed:driver
```

### 7. OSRM self-hosted (Docker)
```
mkdir -p /opt/osrm && cd /opt/osrm
wget https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf   # Saudi is inside GCC States
docker run --rm -t -v "$PWD:/data" osrm/osrm-backend osrm-extract  -p /opt/car.lua /data/gcc-states-latest.osm.pbf
docker run --rm -t -v "$PWD:/data" osrm/osrm-backend osrm-partition /data/gcc-states-latest.osrm
docker run --rm -t -v "$PWD:/data" osrm/osrm-backend osrm-customize /data/gcc-states-latest.osrm
docker run -d --restart=always --name osrm -p 127.0.0.1:5000:5000 -v "$PWD:/data" \
  osrm/osrm-backend osrm-routed --algorithm mld /data/gcc-states-latest.osrm
# backend already proxies /api/osrm -> 127.0.0.1:5000 (routes/osrm.js); pull + restart if not deployed:
cd /opt/SmartMappiaa && git pull && cd smartmappia-web-main/backend && npm install --omit=dev && pm2 restart smartmappia-api
```

### Redeploy after any code change
- Backend: `cd /opt/SmartMappiaa && git pull && cd smartmappia-web-main/backend && npm install --omit=dev && pm2 restart smartmappia-api`
- Frontend: `cd /opt/SmartMappiaa/smartmappia-web-main/frontend && git pull && npm run build`

### Still to do
- End-to-end KYC test (new driver -> upload -> admin verify -> approved).
- Launch hardening: rotate Supabase service_role, revoke Hostinger token, remove `user123`/`driver123`.
