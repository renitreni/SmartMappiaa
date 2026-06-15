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

### 2. Create the admin (one-time, this is a real tool)

```bash
cd backend && npm run seed:admin     # admin123@smartmappia.com / admin123
```

### 3. Seed instant demo data (run from `backend/`)

| Command | Gives you | Open |
|---|---|---|
| `npm run seed:pay` | An unpaid booking | `/pay/<code>` — **payment** screen |
| `npm run seed:request` | A paid, confirmed ride **waiting for a driver** | driver accepts it at `/driver` |
| `npm run seed:demo` | A ride **already in progress** with a driver + live GPS | `/track/<code>` — **live tracking** |
| `npm run seed:clean` | 🧹 removes **all** demo data | — |

`seed:demo` and `seed:request` also ensure an **approved demo driver** exists:
`driver1@smartmappia.com` / `***REMOVED***`.

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

| Role | Email | Password |
|---|---|---|
| Admin | `admin123@smartmappia.com` | `admin123` |
| Driver | `driver1@smartmappia.com` | `***REMOVED***` |
| Rider | sign up live at `/signup` | — |

---

## Removing the demo completely (when you're done)

Three steps, in this order:

```bash
# 1. Wipe the demo data from the database (real data is untouched)
cd backend && npm run seed:clean

# 2. Delete the demo scripts folder
rm -rf scripts/demo

# 3. (optional) delete this playbook
rm ../DEMO.md
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
