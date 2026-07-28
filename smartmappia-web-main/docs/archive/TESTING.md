# Before you test

Read this first. The app has a backend, so opening the frontend on its own won't get you a working
driver flow or a live map. Do the steps below once and everything works.

If someone gave you a **hosted link** instead, skip setup and jump to [Log in](#log-in).

## You need

- Node 18+ (`node -v` to check)
- A free [Supabase](https://supabase.com) project
- This repo, on the `full` branch (it has both frontend and backend)

## Set it up (about 10 minutes)

1. **Database.** In Supabase → SQL Editor, run these three files in order:
   - `backend/migrations/0001_init_smart_mappia.sql`
   - `backend/migrations/0002_auth_driver_approval.sql`
   - `backend/migrations/0003_profile_registration_fields.sql`
2. **Storage.** Create a **private** bucket named `payment-proofs`.
3. **Auth.** Authentication → Providers → Email → turn **off** "Confirm email".
4. **Env files.** Copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` →
   `frontend/.env`, then fill in your Supabase URL and keys (the service-role key goes in the
   backend only).
5. **Accounts + run:**
   ```bash
   cd backend  && npm install && npm run seed:accounts && npm run dev
   cd frontend && npm install && npm run dev
   ```

Full detail lives in [PILOT.md](PILOT.md) if you get stuck.

## Log in

Open `http://localhost:5173` (or your hosted link) and use:

| Role | Email | Password |
|---|---|---|
| User | `user123@smartmappia.com` | `user123` |
| Driver | `driver123@smartmappia.com` | `driver123` |
| Admin | `admin123@smartmappia.com` | `admin123` |

## Test the driver flow

Use two browser windows.

1. **User** books a ride: sign in as `user123` → `/book` → fill it in → pay (upload any image,
   it auto-verifies) → you land on `/track`.
2. **Driver** picks it up: sign in as `driver123` in a second window → `/driver` → **Go online** →
   the request appears → **Accept** → step through on the way → arrived → started → completed.
3. Watch the user's `/track` window update live — the driver moves and the ETA changes.

## About the map

The route line on `/track` follows real roads because the app calls **OSRM**, a free public routing
service. There's nothing to install or configure — you only need an internet connection. If you ever
see a straight line instead of a road route, OSRM was briefly unreachable; refresh and it comes back.
