# Smart Mappia — Frontend

The React app for Smart Mappia: the marketing site plus the customer, driver, merchant, and admin
portals for both service lines (Pick & Drop airport transfers and Food Delivery).

**React 19 + Vite 8 + Tailwind CSS 4 + React Router 7.** Supabase for auth, realtime, and uploads.
**Google Maps Platform** for maps, routing, geocoding, and places. The same build is wrapped with
**Capacitor 8** to ship the Android app.

**Live:** https://smartmappia.com (talks to `https://api.smartmappia.com`).

> Detailed engineering documentation is kept private and is **not** in this repository. If you have
> the working copy, see `docs/engineering/` — in particular Part 11 for the full page-by-page
> reference. This README is intentionally self-contained so it stands alone without it.

---

## Run it

```bash
npm install
cp .env.example .env     # see the environment table below
npm run dev              # http://localhost:5173
```

Start the backend separately (`cd ../backend && npm run dev`).

```bash
npm run build            # static files land in dist/
npm run preview          # serve the build locally
npm run lint             # ESLint 10 flat config
```

The frontend only ever uses the Supabase **anon** key. The service-role key stays in the backend.

---

## Environment

Compiled in at **build** time — a change requires a rebuild, not a restart.
`.env.example` is the authoritative reference.

| Variable | Purpose |
|---|---|
| `VITE_API_BASE` | Backend base URL |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | **Anon key only** — never the service-role key |
| `VITE_GOOGLE_MAPS_BROWSER_KEY` | Maps JS API. Restrict by HTTP referrer in Google Cloud. |
| `VITE_GOOGLE_MAP_ID` | **Required** — a vector Map ID, needed for `AdvancedMarkerElement` |
| `VITE_TAP_ENABLED` | Online payment flag. `false` by default; manual STC Pay is the live path. |

> **`VITE_` is a security boundary.** Vite inlines any `VITE_`-prefixed variable into the public
> client bundle. Never give a server secret a `VITE_` name.

> Retired: `VITE_OSRM_BASE` and `VITE_MAP_STYLE_URL`. Routing and geocoding now go through the
> backend proxies. If `.env.production` still sets `VITE_OSRM_BASE`, remove it.

---

## Structure

```
src/
├── main.jsx          Router, providers, and EVERY route definition
├── App.jsx           The marketing landing page only — not an app shell
├── index.css         Tailwind import + @theme brand tokens + map pin CSS
│
├── components/       Marketing and generic shared components (+ booking/)
├── sections/         The 12 marketing landing-page sections
├── config/company.js Single source of truth for contact and legal details
│
└── portal/           THE APPLICATION — everything behind a login
    ├── auth/         Login, signup
    ├── user/         home, book, pay, track, profile, transactions, notifications
    ├── driver/       DriverPage, DriverVerification (KYC), DriverDispatch
    ├── merchant/     MerchantDashboard, MerchantLayout, MerchantOrders
    ├── admin/        AdminLayout, AdminPage, Dashboard, FoodAdmin
    ├── food/         home, restaurant, cart, checkout, orders, track
    ├── components/   Shared portal UI (ui.jsx design system, RideMap, LocationPicker)
    └── lib/          api.js, AuthProvider, useBroadcast, constants, invoice, csv
```

**Two rules govern the whole frontend:**

1. **Every route is declared in `src/main.jsx`.** No nested or file-based routing — that one file is
   the complete map of the application.
2. **Every backend call goes through `src/portal/lib/api.js`.** No component calls `fetch` directly.
   One `request()` helper attaches the bearer token, handles the base URL, and surfaces errors;
   `{ silent: true }` suppresses the error dialog for polling loops.

---

## Routes

| Access | Routes |
|---|---|
| **Public** | `/` landing · `/login` · `/signup` · `/pay/:code` · `/track/:code` · `/food` · `/food/r/:id` |
| **Any signed-in user** | `/notifications` · `/transactions` · `/profile` · `/food/cart` · `/food/checkout` · `/food/orders` · `/food/track/:code` |
| **passenger** | `/home` · `/book` |
| **driver** | `/driver` |
| **merchant** | `/merchant` |
| **admin** | `/admin` |

`/pay/:code` and `/track/:code` are **deliberately public**, gated by an unguessable code — a
customer completing payment may not be signed in on that device, and a tracking link is shared with
whoever is meeting the passenger.

Driver, merchant, and admin each use **one route with conditional sub-screens** (tabs), not nested
routes. Sub-screens are therefore not linkable and are lost on refresh.

Role gating is via `RequireAuth`; the post-login landing page comes from `roleHome()` in
`portal/lib/constants.js`.

---

## State and data freshness

No Redux, Zustand, or React Query. Two contexts plus local state:

| Provider | State |
|---|---|
| `AuthProvider` | Supabase session, profile, role, `driverApproved` — via `useAuth()` |
| `ViewModeProvider` | Admin "preview as" role, in `sessionStorage` |

Preview mode is a **UI convenience, not a permission change** — the JWT is unchanged and the server
still sees an admin.

Every live screen uses the same pattern: an initial fetch, then a Supabase Realtime subscription via
`useBroadcast`, with an **8-second polling fallback**. `useBroadcast` returns `connected` so the page
knows which mode it is in. **Polling is the correctness guarantee**; realtime is the accelerator.

---

## Maps

**Google Maps Platform**, migrated July 2026 from MapLibre + self-hosted OSRM.

```
RideMap.jsx          shell: border, height, legend, React.lazy(GoogleMap)
  └─ google/GoogleMap.jsx   the renderer (lazy chunk, hand-rolled script loader)
RoutedRideMap.jsx    RideMap + fetchRoute(), refetch gated on a ~100 m signature
```

**No page imports a map vendor.** Consumers use `RideMap` or `RoutedRideMap`, and the vendor lives
behind them. This seam survived the last migration unchanged — **keep it that way.**

- Markers are `AdvancedMarkerElement` (hence the required Map ID), reconciled by key so they update
  rather than leak.
- Routing goes through `portal/lib/osrm.js` — **filename retained, provider is now Google** — which
  calls the backend `/api/route` proxy and decodes the polyline inline.
- Geocoding and places are **never called from the browser**; `LocationPicker` uses `/api/locations/*`
  with a Places session token, a 550 ms debounce, and a ~150 m movement gate to control cost.
- Geolocation branches on `Capacitor.isNativePlatform()` — `@capacitor/geolocation` (Fused Location)
  in the app, `navigator.geolocation` in the browser.

---

## Styling

Tailwind v4, utility-first. **No `tailwind.config.js` and no `postcss.config.js`** — Tailwind is
configured entirely through the Vite plugin plus an `@theme` block in `src/index.css` defining the
brand tokens (`bg-brand-orange`, `text-brand-grey`, and so on).

Reusable styles are exported as **string constants** (`btnPrimary`, `inputClass`, `btnGhost`) from
`portal/components/ui.jsx`, not as `@apply` classes.

---

## Android

The APK is the same `dist/` bundle inside a Capacitor WebView. There is no separate mobile codebase.

```bash
npm run build
npx cap sync            # MANDATORY — without it the APK ships a stale bundle
cd android && ./gradlew assembleRelease
```

| Requirement | Value |
|---|---|
| **JDK** | **21** — JDK 17 fails |
| minSdk / targetSdk | 24 / 36 |
| appId | `com.smartmappia` |

Two integration constraints:

- The WebView origin is `https://localhost`, which must appear in the backend `CORS_ORIGINS` — but
  **not first**, because the Tap redirect uses `CORS_ORIGINS.split(',')[0]`.
- The Google browser key's referrer restrictions must include `https://localhost/*`, or the map
  renders blank in the APK.

A PWA layer also exists: `public/manifest.webmanifest` and `public/sw.js` (shell cache plus a push
handler, registered only in production builds).

---

## Production

Built on the VPS and served as static files by Nginx (apex and `www`), HTTPS via Certbot, Cloudflare
in front.

```bash
git pull && npm install && npm run build
```

> **Expect this on every VPS deploy.** Vite 8 uses the rolldown bundler, which needs a
> platform-specific native binary. The committed `package-lock.json` was generated on Windows, so npm
> skips the Linux one and the build fails with `Cannot find native binding`:
>
> ```bash
> rm -rf node_modules package-lock.json && npm install && npm run build
> ```
>
> It recurs because the next `git pull` restores the Windows lockfile.

---

## Known gaps

- **No 404 route** — `main.jsx` has no `*` catch-all, so an unknown path renders blank.
- **Maps migration cleanup unfinished:** `portal/components/maplibre/MapLibreMap.jsx` is dead code,
  `maplibre-gl` and `pmtiles` are still dependencies, and residual `.maplibregl-*` CSS remains in
  `index.css`. (`maplibre/pinHtml.js` beside it **is** live and correct — only the folder name is
  misleading.)
- **Android assets were synced before the Google Maps migration** — run `npm run build && npx cap
  sync` before the next APK.
- **Tabs instead of nested routes** in the driver, merchant, and admin portals — screens are not
  linkable, and the files have grown large (`DriverPage.jsx` 1,514 lines, `FoodAdmin.jsx` 1,448).
- **Per-page fetch/loading/error/polling duplication** — React Query would remove most of it.
- `src/App.css` is unused Vite starter leftovers.
- Duplicate booking submits create two bookings; ride creation has no idempotency key.
