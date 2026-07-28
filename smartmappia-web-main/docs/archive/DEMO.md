# Smart Mappia — Demo / Presentation Playbook

Everything you need to show the app off, **plus a clear line between what's the real app and
what's just demo scaffolding** so you can wipe the demo later without a second thought.

---

## The golden rule: real vs. demo

> **The real app never depends on anything in the demo.** The demo only *adds sample data* to
> the database and *reads* the normal screens. Delete it all and the app keeps working.

**✅ REAL — the actual product (keep this):**

- `frontend/` — the entire React app, including every screen you demo:
  - `/book` (booking), `/pay/:code` (payment), `/track/:code` (live tracking),
    `/driver` (driver portal), `/admin` (admin dashboard), `/login`, `/signup`.
- `backend/` — the Express API + Supabase: bookings, payments, the Grab-style driver
  self-accept feed, live tracking, ledger, auth. Everything except the `scripts/demo/` folder.
- `backend/scripts/seed-admin.js` — creates an admin account. This is a real tool you keep
  (just change the credentials for production).

**🧪 DEMO — sample data + tooling (safe to delete):**

| Thing | What it is |
|---|---|
| `backend/scripts/demo/` | **All** demo seed scripts live here, nothing else. |
| The `seed:demo` / `seed:pay` / `seed:request` / `seed:clean` npm scripts | Shortcuts to the above. |
| `DEMO.md` | This file. |
| Demo rows in the database | Every booking the scripts create is tagged `notes = '__DEMO__'`; plus the demo driver `driver1@smartmappia.com`. |

That's the entire demo footprint. Nothing in `frontend/` or `backend/lib`, `controllers`,
`routes`, etc. is demo.

---

## Running the demo

### 1. Start both servers

```bash
cd backend && npm run dev      # http://localhost:4000
cd frontend && npm run dev     # http://localhost:5173
```

Check: `curl http://localhost:4000/api/health` → `"db":"connected"`. `"testMode":true` means
payments auto-verify instantly (great for demos).

### 2. Create the test accounts (one-time, these are real tools)

```bash
cd backend && npm run seed:accounts   # creates all three at once:
#   admin123@smartmappia.com  / admin123   (admin)
#   user123@smartmappia.com   / user123    (passenger)
#   driver123@smartmappia.com / driver123  (driver, pre-approved)
```

Re-run `npm run seed:accounts` anytime to **repair a stale role** (it hard-resets each account
to its correct role — handy if a test user ever got stuck on the admin dashboard). To inspect or
fix roles directly in Supabase, see `backend/migrations/utilities/profile-roles.sql`.

### 3. Seed instant demo data (run from `backend/`)

| Command | Gives you | Open |
|---|---|---|
| `npm run seed:pay` | An unpaid booking | `/pay/<code>` — **payment** screen |
| `npm run seed:request` | A paid, confirmed ride **waiting for a driver** | driver accepts it at `/driver` |
| `npm run seed:demo` | A ride **already in progress** with a driver + live GPS | `/track/<code>` — **live tracking** |
| `npm run seed:clean` | 🧹 removes **all** demo data | — |

`seed:demo` and `seed:request` also ensure an **approved demo driver** exists:
`driver1@smartmappia.com` / `driver123`.

---

## The walkthrough (the story to tell)

**Option A — the full live flow (most impressive):** sign in, then
`/book` → **Continue to payment** → upload a screenshot (auto-verifies) → land on `/track/:code`.

**Option B — jump straight to a polished screen:** run the matching `seed:*` command and open
the URL it prints.

**The driver hand-off (do this in two windows):**
1. `npm run seed:request` → gives you an open ride + the rider's tracking URL.
2. Window 1 (rider): open the printed `/track/<code>` — shows "Finding your driver…".
3. Window 2 (driver): `/driver`, sign in as `driver1@…`, **Go online** → the request appears
   nearest-first → **Accept** → walk the statuses (on the way → arrived → started → completed).
4. Watch Window 1 update live — driver card, the moving car, ETA, WhatsApp button.

**Admin:** sign in as admin → `/admin` → review/verify payments and the **Drivers** approval tab.

| Role | Email | Password | Source |
|---|---|---|---|
| Admin | `admin123@smartmappia.com` | `admin123` | `seed:accounts` |
| User (rider) | `user123@smartmappia.com` | `user123` | `seed:accounts` |
| Driver | `driver123@smartmappia.com` | `driver123` | `seed:accounts` (pre-approved) |
| Demo driver | `driver1@smartmappia.com` | `driver123` | `seed:demo` / `seed:request` |
| New rider | sign up live at `/signup` | — | default role for any new account |

---

## Demoing the latest QA fixes

Three things were just fixed/added. Here's the quickest way to show each.

### A. Role-based login lands on the right screen
Sign in (one at a time) and confirm where each account lands:

| Sign in as | Lands on |
|---|---|
| `user123@smartmappia.com` | **`/book`** (the rider booking screen) |
| `driver123@smartmappia.com` | **`/driver`** |
| `admin123@smartmappia.com` | **`/admin`** |

Then sign up a brand-new account at `/signup` as a **User** → it also lands on **`/book`**.
(Previously a rider could be dropped on the homepage or, with a stale role, the admin dashboard.)

> If a seeded account ever lands somewhere wrong, its DB role is stale — run
> `npm run seed:accounts` (or use `backend/migrations/utilities/profile-roles.sql`) to reset it.

### B. Live route + ETA on the tracking map (real roads, not a straight line)
1. Sign in as `user123`, go to `/book`, **Continue to payment**, upload any image as proof
   (auto-verifies) → you land on `/track/:code`.
2. On the map you'll see a **road-following route line** between pickup and drop-off **plus an
   ETA badge** — and it shows up **immediately**, before any driver is assigned (not just pins).
3. (Optional, for the live driver leg) run `npm run seed:demo` in `backend/` and open the printed
   `/track/<code>` — the route redraws from the moving driver to the pickup with a live ETA.

> Under the hood this calls the public OSRM routing service. If it's ever unreachable the map
> quietly falls back to a straight guide line + estimated ETA, so the demo never breaks.

### C. Admin "View" switch — preview the User/Driver app without logging out
1. Sign in as `admin123` → `/admin`.
2. In the header, open the **View** dropdown (it replaced the old Refresh button; **Refresh** is
   still the first item).
3. **Switch to User View** → the rider app (`/book`) renders and a **"Previewing as User"** banner
   appears at the bottom. You're still logged in as admin — no re-login happened.
4. Open the View menu again (or use the banner) → **Switch to Driver View** → `/driver` renders
   with a **"Previewing as Driver"** banner. To show it end-to-end: run `npm run seed:request`
   first, then while previewing as driver, **Go online** and **Accept** the open ride.
5. Click **Back to Admin View** on the banner → you're back on `/admin`, still the same admin
   session throughout.
6. Sign in as `user123`/`driver123` to confirm the **View** dropdown and banner **never** appear
   for non-admins.

> ⚠️ **Heads-up for the demo:** previewing uses the admin's real login, and the backend now lets
> admin act through the user/driver screens. So any real action you take while previewing
> (accepting a ride, uploading a proof, posting GPS) **writes real data** — e.g. accepting a ride
> assigns *the admin* as that ride's driver. Fine for a demo; just don't mistake it for read-only.

---

## Removing the demo completely (when you're done)

Three steps, in this order:

```bash
# 1. Wipe the demo data from the database (real data is untouched)
cd backend && npm run seed:clean

# 2. Delete the demo scripts folder
rm -rf scripts/demo

# 3. (optional) delete this playbook
rm ../docs/DEMO.md
```

Then remove the four demo lines from `backend/package.json` → `scripts`
(`seed:demo`, `seed:pay`, `seed:request`, `seed:clean`). Keep `seed:admin`.

That's it — no other file references the demo, so nothing breaks. The app, the driver portal,
payments, tracking, and admin all keep working exactly as before.

> **Why this is safe:** every demo booking carries `notes = '__DEMO__'`, so `seed:clean` deletes
> *only* those rows (their proofs/events/payments/ledger cascade automatically) and the
> `driver1@…` demo account. Your real bookings, the admin account, and any real drivers are
> never touched.

---

## Tips

- Set a real-looking `SMART_MAPPIA_STCPAY_NUMBER` in `backend/.env` so the payment screen looks
  fully filled in.
- Re-run any `seed:*` for a fresh code anytime.
- For production: flip `AUTO_VERIFY_STCPAY_TEST_MODE=false`, change the admin credentials, and
  run `seed:clean`. See `backend/DOCUMENTATION.md` §10 for the full go-live checklist.
