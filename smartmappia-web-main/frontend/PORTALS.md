# Smart Mappia — Pick & Drop Portals (Frontend)

Welcome 👋 — this is the frontend half of Smart Mappia: a Grab-style Pick & Drop experience
bolted onto the existing React + Vite marketing site. There are three people in this story —
the **rider**, the **driver**, and the **admin** — and this doc walks through how each of them
gets what they need.

It's plain React 19 + Vite, styled with Tailwind, with three small extra dependencies doing the
heavy lifting: routing, Supabase (auth + realtime + uploads), and free OpenStreetMap maps.

---

## The map of the app (routes)

| Route | Who it's for | What happens there |
|---|---|---|
| `/` | everyone | The marketing landing page. The navbar now has **Sign in** and **Book a Ride**. |
| `/login`, `/signup` | everyone | Email + password. Signup lets you pick **Rider** or **Driver**. |
| `/book` | signed-in users | Book a trip → pay by STC Pay (upload the screenshot) → off to tracking. Bounces you to `/login` if you're signed out. |
| `/pay/:code` | anyone with the code | The payment screen on its own — STC Pay details, the itemized fare, and the proof upload. Deep-linkable (the `/book` flow leads here too). |
| `/track/:code` | anyone with the code | The star of the show: a **live map** with the driver moving, an ETA ticking down, WhatsApp the driver, pickup/drop-off pins, a cancel button, and the trip timeline. |
| `/driver` | role: driver | Go online, share GPS, watch the **nearest open requests** roll in, accept one, drive the trip, WhatsApp the rider. Locked until an admin approves you. |
| `/admin` | role: admin | Review payment screenshots (verify/reject), **approve drivers**, and browse every booking. |

---

## Signing in (and who's who)

Accounts are real, backed by **Supabase Auth** (email + password). The moment someone signs in,
the app makes a single call to `POST /api/auth/sync`, which creates or updates their `profiles`
row and figures out their role. From then on, every request to the backend carries the Supabase
access token (`Authorization: Bearer …`) and the backend decides what they're allowed to do.

The three roles:

- **Rider (passenger)** — the default. You have to be signed in to book a ride or cancel one.
- **Driver** — you can sign up and sign in straight away, but you'll land on a polite
  "pending approval" screen. An admin flips you to approved on the **Drivers** tab of `/admin`,
  and only then can you see the open feed or accept rides.
- **Admin** — there's no admin signup on purpose. Any account whose email is in the backend's
  `ADMIN_EMAILS` list is automatically an admin the next time it signs in.

`RequireAuth` is the little gatekeeper component that guards routes — it redirects to `/login`
when you're signed out and shows a friendly "wrong account type" screen if, say, a rider tries
to open `/driver`.

### Getting your first admin in

One thing that trips people up: **signing in goes straight to Supabase, not to our backend.**
The browser calls Supabase Auth directly; our server only hears about it afterwards. So a
"wrong email/password" error means Supabase doesn't recognize that account — not that the
backend is offline. And adding an email to `ADMIN_EMAILS` doesn't *create* a login, it only
*promotes* an existing account to admin. You still have to create the user first:

- **Easiest** — run the backend seeder once: `cd backend && npm run seed:admin`. It creates
  `admin123@smartmappia.com` / `admin123` (override with `ADMIN_SEED_*`), pre-confirms the
  email, and makes it admin. Then sign in at `/login`.
- **Or** — just sign up at `/signup` with the admin email; the next sign-in promotes it. (Needs
  "Confirm email" turned **off** in Supabase, or confirm via the email link first.)

### Sign-in troubleshooting

- **"Auth is not configured…"** → `frontend/.env` is missing `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY`. Add them (anon/public key), then restart `npm run dev`.
- **"Invalid login credentials"** → that account doesn't exist in Supabase yet (or the password
  is wrong). Create it with the seeder or `/signup`.
- **"Email not confirmed"** → confirm via the email link, or turn off "Confirm email", or use
  the seeder (it pre-confirms).

---

## How a ride actually flows

Here's the whole thing, with the realtime nudges that make it feel alive:

```
Rider signs in → /book → creates the booking (pending_payment)
   │ uploads the STC Pay screenshot
   ▼
payment verified  (an admin clicks Verify, or it auto-verifies in test mode)
   │  backend broadcasts:  booking-<code> "status"  +  drivers-available "new_request"
   ▼
Rider on /track/<code>              Driver on /driver (online)
  "Finding your driver…"            the request pops into the feed, nearest first
                                    taps Accept ──atomic claim──▶ first driver wins
   │ booking-<code> "status" (driver assigned + contact)           │
   ▼                                                                ▼
  driver card + WhatsApp            phone sends GPS every ~12s ──▶ backend broadcasts
  the car moves, ETA updates  ◀─────  booking-<code> "status" (driverLocation, eta)
   │                                  on_the_way → arrived → started → completed
   ▼                                                                │
  timeline fills in                                  completing the ride writes the payout
```

Two things worth calling out:

- **Live updates** ride on **Supabase Realtime Broadcast** — channels keyed by public data, so
  no internal IDs ever leak to the browser. Every screen *also* quietly polls as a backup, so if
  Realtime isn't configured the app still works, just a touch less snappy.
- **"First driver wins"** is enforced on the backend with an atomic claim, so two drivers tapping
  Accept at the same instant can never both get the ride.

---

## Getting it running

1. **Install** (if you haven't): `npm install`
2. **Environment** — copy `.env.example` → `.env` and fill in:
   - `VITE_API_BASE` — where the backend lives (defaults to `http://localhost:4000`)
   - `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` — the **anon/public** key only. (The
     service-role key belongs in the backend and nowhere near the browser.) These power both
     Realtime and the proof uploads.
3. **Run** — from `frontend/`, `npm run dev`; and start the backend separately
   (`cd backend` → `npm run dev`).

### One-time Supabase setup

A handful of switches in the Supabase dashboard make the live features work:

- **Database** — run `0001_init_smart_mappia.sql`, then `0002_auth_driver_approval.sql`
  (that second one adds the driver-approval flag).
- **Auth** — the email provider is on by default. For a frictionless MVP, turn **off**
  "Confirm email" (Auth → Providers → Email) so new signups get a session right away. If you
  leave it on, people confirm via email first — the signup screen already handles both cases.
- **Admins** — set `ADMIN_EMAILS` in the *backend* env; those accounts become admins on sign-in.
- **Storage** — create a **private** bucket named `payment-proofs`.
- **Realtime** — enable it. The portals subscribe to public Broadcast channels
  (`booking-<code>`, `drivers-available`, `admin-bookings`). If you switch on Realtime
  Authorization (private channels), add a read policy — otherwise live updates simply fall back
  to polling.

---

## What's under the hood

Three dependencies were added, each pulling real weight:

- **`react-router-dom`** — routing for the four portals.
- **`@supabase/supabase-js`** — Auth, Realtime Broadcast subscriptions, and the signed-URL proof
  upload.
- **`leaflet` + `react-leaflet`** (v5, React 19) — free OpenStreetMap maps, **no API key, no
  billing**.

### File map

```
src/portal/
├── lib/
│   ├── api.js            # backend client — auto-attaches the auth token
│   ├── supabaseClient.js # anon Supabase client (realtime + proof upload)
│   ├── AuthProvider.jsx  # session + profile/role context (useAuth)
│   ├── useBroadcast.js   # subscribe to a realtime channel
│   ├── geo.js            # haversine distance + a geolocation hook
│   └── constants.js      # airports, fare breakdown, status labels, WhatsApp links
├── components/
│   ├── RideMap.jsx       # Leaflet/OSM map with clean colored pins
│   ├── RequireAuth.jsx   # route guard (redirect / wrong-role screen)
│   └── ui.jsx            # shell, badge, spinner, inputs, buttons
├── auth/
│   ├── LoginPage.jsx     # /login
│   └── SignupPage.jsx    # /signup  (Rider or Driver)
├── user/
│   ├── BookPage.jsx      # /book
│   └── TrackPage.jsx     # /track/:code  (the live tracking screen)
├── driver/DriverPage.jsx # /driver
└── admin/AdminPage.jsx   # /admin
```

---

## Deploying

- The root `vercel.json` rewrites every path to `index.html`, so deep links like `/track/SM-…`,
  `/driver`, and `/admin` survive a hard refresh.
- Set the same `VITE_*` env vars in the Vercel dashboard for the frontend project.
- The backend deploys separately from the `backend/` folder (it has its own `vercel.json`).
- Geolocation and the file picker need **HTTPS** — Vercel gives you that, and browsers treat
  `localhost` as secure too, so local dev is fine.

---

If you change behavior here, give this doc a nudge to match — future-you will be grateful. 🙂
