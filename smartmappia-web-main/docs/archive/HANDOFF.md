# Smart Mappia — Developer Handoff

Welcome aboard 👋 — this gets you from a fresh clone to **seeing every screen** (login, rider
booking, payment, tracking, driver, admin) in a few minutes. For deeper detail there are three
companion docs:

- **`backend/DOCUMENTATION.md`** — backend internals, the full API, auth, go-live checklist.
- **`frontend/PORTALS.md`** — frontend architecture, the realtime model, file map.
- **`DEMO.md`** — presentation playbook + how to delete the demo data cleanly.

---

## 1. What this is

An Airport Pick & Drop app (Grab-style): a rider books a ride, pays via STC Pay, a nearby
driver accepts it, and the rider tracks the car live. Three roles: **rider, driver, admin**.

```
smartmappia-web-main/
├── frontend/   React + Vite app (all the UI/screens)
├── backend/    Node + Express API on Supabase (Postgres + Auth + Storage)
├── DEMO.md     presentation + how to remove demo data
└── HANDOFF.md  this file
```

---

## 2. One-time setup

**Prereqs:** Node 18+, a Supabase project (free tier is fine).

**a) Database** — in Supabase → SQL Editor, run in order:
`backend/0001_init_smart_mappia.sql`, then `backend/0002_auth_driver_approval.sql`.

**b) Storage** — create a **private** bucket named `payment-proofs`.

**c) Auth** — Auth → Providers → Email: turn **off** "Confirm email" (so new signups log in
immediately).

**d) Environment files** (copy the templates, fill in values):

```bash
# backend/.env   (from backend/.env.example)
SUPABASE_URL=...                  # Supabase → Settings → API → Project URL
SUPABASE_SERVICE_ROLE_KEY=...     # Settings → API → service_role key (server only!)
ADMIN_EMAILS=admin123@smartmappia.com
AUTO_VERIFY_STCPAY_TEST_MODE=true # auto-verifies payments while testing

# frontend/.env  (from frontend/.env.example)
VITE_API_BASE=http://localhost:4000
VITE_SUPABASE_URL=...             # same Project URL
VITE_SUPABASE_ANON_KEY=...        # the ANON / public key (NOT service_role)
```

**e) Install + run** (two terminals):

```bash
cd backend  && npm install && npm run dev      # → http://localhost:4000
cd frontend && npm install && npm run dev      # → http://localhost:5173
```

Health check: `curl http://localhost:4000/api/health` should show `"db":"connected"`.

**f) Create the admin + test accounts:**

```bash
cd backend
npm run seed:admin     # admin123@smartmappia.com / admin123
npm run seed:demo      # also creates an APPROVED driver: driver1@smartmappia.com / driver123
```

---

## 3. How to access each UI

Base URL is **http://localhost:5173**. Auth is real (Supabase JWT); some screens need a role.

| Screen | URL | Who can open it | How to get there |
|---|---|---|---|
| **Landing** | `/` | anyone | Home page; navbar has **Sign in** + **Book a Ride**. |
| **Login** | `/login` | anyone | Sign in with email + password. |
| **Sign up** | `/signup` | anyone | Register as **Rider** or **Driver**. |
| **Rider — Book** | `/book` | signed-in users | Navbar **Book a Ride**. (Redirects to `/login` if signed out.) |
| **Payment** | `/pay/:code` | anyone with a booking code | Reached from `/book` → **Continue to payment**, or open directly with a code. |
| **Tracking** | `/track/:code` | anyone with a booking code | Where booking lands after payment. Deep-linkable. |
| **Driver** | `/driver` | role = driver (admin-approved) | Sign in as a driver. Unapproved drivers see a "pending" screen. |
| **Admin** | `/admin` | role = admin | Sign in with an `ADMIN_EMAILS` account. |

### The fastest way to see each screen

Run the matching command from `backend/` — each prints the exact URL to open:

| To see… | Run | Then open |
|---|---|---|
| **Login / Sign up** | — | `/login` · `/signup` |
| **Rider booking** | (sign in first) | `/book` |
| **Payment** | `npm run seed:pay` | the printed `/pay/<code>` |
| **Tracking (live)** | `npm run seed:demo` | the printed `/track/<code>` |
| **Driver (accept a ride)** | `npm run seed:request` | `/driver` as `driver1@…`, **Go online**, Accept |
| **Admin** | (sign in as admin) | `/admin` |

### Test accounts

| Role | Email | Password | Notes |
|---|---|---|---|
| Admin | `admin123@smartmappia.com` | `admin123` | from `seed:admin`; admin via `ADMIN_EMAILS` |
| Driver | `driver1@smartmappia.com` | `driver123` | from `seed:demo`; already approved |
| Rider | sign up at `/signup` | — | default role for any new account |

> Tip: to demo the live driver↔rider hand-off, open the rider in one browser window and the
> driver in a second (or incognito) and watch the tracking update in real time.

---

## 4. How the screens connect (the flow)

```
/signup or /login
      │
      ▼
/book  ──Continue to payment──▶  /pay/:code  ──upload proof (auto-verifies)──▶  /track/:code
                                                                                    ▲
/driver  (driver goes online → sees the request → Accept → drives) ─── live updates ┘
/admin   (verify payments, approve drivers)
```

Live updates use **Supabase Realtime**; every screen also polls as a fallback, so it works even
if realtime isn't configured.

---

## 5. Good to know

- **Auth doesn't go through our backend** — the browser talks to Supabase Auth directly, then
  our API verifies the token. A "wrong credentials" error means the account doesn't exist in
  Supabase yet (create it via `seed:admin` / `/signup`), not that the backend is down.
- **Admins** are granted by email (`ADMIN_EMAILS`) — there's no admin sign-up.
- **Drivers** need admin approval before they can accept rides (`/admin` → Drivers tab).
- **Fare** is flat **SAR 100 base + 3.75% service fee = SAR 103.75** (`backend/lib/fare.js`).
- **Demo vs real:** all demo tooling is isolated in `backend/scripts/demo/` and documented in
  `DEMO.md` — including a one-command `npm run seed:clean` to wipe demo data.
- **Going live:** see `backend/DOCUMENTATION.md` §10 (flip `AUTO_VERIFY_STCPAY_TEST_MODE=false`,
  real STC Pay number, lock CORS, etc.).
