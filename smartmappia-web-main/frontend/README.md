# Smart Mappia — Frontend

The React app for Smart Mappia's Airport **Pick & Drop**: the marketing site plus the rider, driver,
and admin portals. **React 19 + Vite + Tailwind**, using Supabase for auth/realtime/uploads and
Leaflet (CARTO/OpenStreetMap tiles) for maps. The same build is wrapped with **Capacitor** to ship
the Android app — see [../docs/production/ANDROID_APP_GUIDE.md](../docs/production/ANDROID_APP_GUIDE.md).

**Live:** https://smartmappia.com (talks to `https://api.smartmappia.com`).

## Run it
```bash
npm install
cp .env.example .env     # fill VITE_API_BASE, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev              # http://localhost:5173
```
Start the backend separately (`cd ../backend && npm run dev`). The frontend only ever uses the
Supabase **anon/public** key — the service-role key stays in the backend.

## Build
```bash
npm run build           # static files land in dist/
npm run preview         # serve the build locally to check it
```

### Environment (`.env`, compiled in at build time — rebuild after changes)
```
VITE_API_BASE=https://api.smartmappia.com
VITE_SUPABASE_URL=<supabase url>
VITE_SUPABASE_ANON_KEY=<anon key>                       # never the service_role key
VITE_OSRM_BASE=https://api.smartmappia.com/api/osrm/route/v1/driving
VITE_TAP_ENABLED=false                                   # "Pay online (coming soon)" until Tap is live
```

## What's in here
- **Marketing site** + **rider**, **driver**, and **admin** portals (`src/portal/`), gated by role.
- **Booking** (login-gated), **manual STC Pay** proof upload, **live tracking** (Supabase Realtime),
  **driver ride flow**.
- **Driver KYC**: `src/portal/driver/DriverVerification.jsx` — unapproved drivers upload documents,
  see status, re-upload rejected ones.
- **Admin**: `src/portal/admin/AdminPage.jsx` — payment verify/reject + Drivers tab with per-driver
  **document review** (View/Verify/Reject; auto-approves once all required docs are verified).
- **Company/contact info** centralized in `src/config/company.js` (used by Footer + legal modals).
- Online payment (Tap) is behind `VITE_TAP_ENABLED` — off by default (manual STC Pay is the path).

## Production notes
- Built on the VPS and served as static files by Nginx (apex + www), HTTPS via Certbot.
- Rebuild + it's live: `git pull && npm run build` (see
  [../docs/production/DEPLOYMENT_LOG.md](../docs/production/DEPLOYMENT_LOG.md)).
- Note: Vite 8 uses the rolldown bundler with a native binary — if `npm install` fails on a fresh
  Linux box with a "native binding" error, `rm -rf node_modules package-lock.json && npm install`.

## Where to read more
- **[PORTALS.md](PORTALS.md)** — routes, roles, ride flow, map/route, admin preview, file map.
- **[../docs/production/ANDROID_APP_GUIDE.md](../docs/production/ANDROID_APP_GUIDE.md)** — the Capacitor
  Android app (build, native geolocation/push, payments, full API reference).
- **[../docs/production/PICK_AND_DROP.md](../docs/production/PICK_AND_DROP.md)** — feature source of truth.
- **[../backend/README.md](../backend/README.md)** — the API side.
