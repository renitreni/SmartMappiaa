# Running a Smart Mappia pilot

This guide takes you from an empty Supabase project to a working Smart Mappia you can put in front of a
small group of testers. It covers local setup and hosting it on your own server.

A pilot is a closed trial. You invite a handful of people you know, they book test rides, and you watch
how it holds up. Payments are simulated (no real money moves), and sign-up is open to anyone who has
the link. That's fine for a trial with friends. It is **not** ready for the public yet — see
[When the pilot is over](#when-the-pilot-is-over) for what that takes.

---

## What you need first

- **Node 18 or newer.** Check with `node -v`.
- **A Supabase project.** The free tier is enough. Sign up at [supabase.com](https://supabase.com).
- **This repository**, cloned to your machine.

Setup runs in about ten minutes if Supabase is ready.

---

## 1. Set up the database

Everything lives in your Supabase project. Open it in the dashboard and do these four things.

**a) Run the migrations.** Go to **SQL Editor**, open a new query, and run these three files **in
order** — copy the contents of each, paste, click run:

1. `backend/migrations/0001_init_smart_mappia.sql` — tables, enums, the booking-code generator.
2. `backend/migrations/0002_auth_driver_approval.sql` — the driver-approval flag.
3. `backend/migrations/0003_profile_registration_fields.sql` — extra sign-up fields (date of birth,
   vehicle, etc.).

**b) Create the storage bucket.** Go to **Storage → New bucket**. Name it `payment-proofs` and mark it
**Private**. This holds the payment screenshots testers upload.

> ⚠️ The bucket must be private. Payment proofs are personal and are served through short-lived signed
> URLs, never public links.

**c) Let new sign-ups log in straight away.** Go to **Authentication → Providers → Email** and turn
**off** "Confirm email". Without this, testers would be stuck waiting for a confirmation mail.

**d) (Optional) Turn on Realtime** if you want the tracking map to update the instant a driver moves.
Skip it and the app falls back to refreshing every eight seconds, which is fine for a pilot.

---

## 2. Configure the environment

The backend and frontend each read their own `.env` file. Copy the templates:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Fill in `backend/.env`:

| Key | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → `service_role` key |
| `ADMIN_EMAILS` | leave as `admin123@smartmappia.com` for the pilot |
| `AUTO_VERIFY_STCPAY_TEST_MODE` | keep it `true` (see the note below) |

Fill in `frontend/.env`:

| Key | Value |
|---|---|
| `VITE_API_BASE` | `http://localhost:4000` for local; your backend's public URL once deployed |
| `VITE_SUPABASE_URL` | the same Project URL as above |
| `VITE_SUPABASE_ANON_KEY` | Settings → API → `anon` / public key |

> ⚠️ The `service_role` key belongs in `backend/.env` and nowhere else. It bypasses every database
> rule. Never paste it into the frontend or commit it. The frontend only ever uses the `anon` key.

Keep `AUTO_VERIFY_STCPAY_TEST_MODE=true` for the pilot. With it on, a tester uploads any screenshot as
"payment" and the booking confirms instantly, so nobody needs a real STC Pay transfer to try the app.

---

## 3. Create the test accounts

From the `backend/` folder:

```bash
cd backend
npm install
npm run seed:accounts
```

That creates three ready-to-use logins:

| Role | Email | Password |
|---|---|---|
| Admin | `admin123@smartmappia.com` | `admin123` |
| User (passenger) | `user123@smartmappia.com` | `user123` |
| Driver (pre-approved) | `driver123@smartmappia.com` | `driver123` |

Testers can also sign up their own account at `/signup`. New accounts are passengers by default.

---

## 4. Run it

### Option A — on your machine (quickest)

Two terminals:

```bash
cd backend  && npm run dev      # API on http://localhost:4000
cd frontend && npm run dev      # app on http://localhost:5173
```

Open `http://localhost:5173`. Quick health check: `curl http://localhost:4000/api/health` should
report `"db":"connected"` and `"testMode":true`.

This is great for a demo on one laptop, or over your local network. For people in other places, host it.

### Option B — on your own server

You deploy two things: the **frontend** (a static site) and the **backend** (a Node API). They can live
anywhere; they only need to reach each other over HTTPS and reach Supabase.

**The fast path — Vercel.** The repo is already set up for it (`vercel.json` in both folders, plus
`backend/api/index.js`). Import `backend/` and `frontend/` as two separate Vercel projects. Paste the
env vars from step 2 into each project's dashboard. Set the frontend's `VITE_API_BASE` to the backend
project's URL. Done.

**Your own VPS (Nginx + Node).** Build the frontend to static files and serve them; run the backend as
a long-lived process.

```bash
# Frontend — build static files
cd frontend
npm install
npm run build            # output lands in frontend/dist/

# Backend — run it under a process manager
cd ../backend
npm install
npm install -g pm2
pm2 start server.js --name smartmappia-api    # serves on PORT (default 4000)
```

Point Nginx at the built frontend and proxy the API:

```nginx
server {
  listen 80;
  server_name your-domain.com;

  # The built React app
  root /var/www/smartmappia/frontend/dist;
  index index.html;
  location / {
    try_files $uri /index.html;   # SPA routing — send unknown paths to index.html
  }

  # The Node API
  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

Set `VITE_API_BASE` to your public API URL **before** you build, since Vite bakes it into the bundle.
Put a TLS certificate in front (Let's Encrypt / Certbot) so everything runs over HTTPS.

> ⚠️ Lock down CORS before you share the link. Right now `backend/app.js` calls `app.use(cors())`,
> which allows requests from any site. Change it to your frontend's domain, for example
> `app.use(cors({ origin: 'https://your-domain.com' }))`.

---

## 5. Run the pilot — the walkthrough

This is the story to show testers. Two browser windows make it land best.

1. **Book a ride.** Window 1: sign in as `user123`. You land on `/book`. Pick a terminal, set a time,
   add a name and WhatsApp number, continue to payment.
2. **Pay.** Upload any image as the "transfer screenshot" and submit. Test mode verifies it on the spot
   and drops you on `/track/<code>`. The map draws the road route from pickup to drop-off with an
   estimated time — not just two pins.
3. **Accept as a driver.** Window 2: sign in as `driver123`, go to `/driver`, **Go online**, and the
   request shows up nearest-first. Accept it, then step through the ride: on the way → arrived →
   started → completed. Watch Window 1 update live.
4. **Look behind the counter.** Sign in as `admin123` at `/admin`. Open the **View** menu (top right,
   where Refresh used to be) and switch to User View or Driver View to see those screens without
   logging out. The "Previewing as…" banner shows you're still the admin underneath. Use **Back to
   Admin View** to return.

> ⚠️ While the admin previews a user or driver, any action is real. If the admin accepts a ride in
> Driver View, that ride is genuinely assigned to the admin account in the database. Handy for testing,
> worth knowing.

---

## The SQL migrations

All migrations live in `backend/migrations/`. Run them once, in order, in the Supabase SQL Editor.

| File | What it adds |
|---|---|
| `0001_init_smart_mappia.sql` | Core schema: profiles, bookings, payments, tracking, ledger, enums. |
| `0002_auth_driver_approval.sql` | `driver_approved` flag so unapproved drivers can't accept rides. |
| `0003_profile_registration_fields.sql` | Sign-up extras: date of birth, gender, vehicle details. |

They're safe to re-run. To confirm they're all applied:

```bash
cd backend && npm run check:migrations
```

**Fixing a stuck role.** If a tester logs in and lands on the wrong dashboard (a passenger sent to the
admin screen, say), their saved role is wrong in the database. The utility
`backend/migrations/utilities/profile-roles.sql` has ready-made queries to inspect and reset roles —
open it, read the comments, run the block you need. Re-running `npm run seed:accounts` also resets the
three seeded accounts to their correct roles.

---

## Known limits during the pilot

- **Payments are simulated.** Test mode auto-verifies uploads; no real STC Pay or card gateway is
  wired in.
- **Routing uses the public OSRM demo server.** It's free and has no uptime promise. If it's slow or
  down, the map falls back to a straight line and a rough time estimate. Good enough for a trial, not
  for production traffic.
- **CORS is open until you close it.** Fine on localhost, but lock it to your domain before sharing a
  hosted link (see step 4).

---

## When the pilot is over

Going public is a real step up from a pilot: a live payment gateway, a hosted routing service, tighter
auth, and the security checklist. All of it is written up in
[`backend/DOCUMENTATION.md`](../backend/DOCUMENTATION.md) section 10, "Test mode → Production". Start
there.

---

## Troubleshooting

| You see | Fix |
|---|---|
| A user logs in and lands on the **admin** dashboard | Their saved role is `admin` in the database. Run `backend/migrations/utilities/profile-roles.sql` to reset it, or re-run `npm run seed:accounts`. |
| "Profile not set up. Please complete registration." | The migrations didn't all run, or the profile row is missing. Run `npm run check:migrations`, then sign in again. |
| "Wrong credentials" on login | The account doesn't exist in Supabase yet. Create it with `npm run seed:accounts` or sign up at `/signup`. |
| The tracking map is blank or shows only a straight line | OSRM couldn't be reached. Check the browser's Network tab for a call to `router.project-osrm.org`. The app still works; the route just falls back to a straight line. |
| Frontend can't reach the API after deploying | `VITE_API_BASE` is wrong, or CORS is blocking it. Confirm the URL and that the backend allows your frontend's origin. |
