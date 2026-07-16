# Changelog — July 2026 (money model, maps, rate limits)

Work landed on branch `full` between 2026-07-12 and 2026-07-16, commits
`7b7b465`, `6cb036b`, `de7a364`, merge `f2e6f20`. This is the team reference
for what changed, why, and what has to happen at deploy time.

## 1. Food: per-item variable markup (net price)

**The model.** Restaurant price lists follow the "X SAR (Y)" pattern (Ka
Inasal): X = the NET price the restaurant keeps, Y = the LIST price shown on
the website. Our markup = list − net, and it varies per item (0–10+ SAR).
The old flat margin (5 SAR meal / 3 SAR drink) could not represent this.

- `menu_items.net_price` (migration **0018**, nullable). `menu_items.price`
  stays the customer-facing list price — customer bills are unchanged
  (`total = subtotal + delivery_fee`); the restaurant payout is
  `subtotal − platform_margin_total`.
- Markup math lives in `backend/lib/foodMoney.js` (`markupPerUnit`):
  `price − net_price` when a net price is set, else the old flat margin by
  `item_type`. Items without a net price (single-price lists like Kuy's, and
  every pre-existing row) keep working untouched.
- **Admin-only control:** `net_price` is whitelisted only on the admin item
  routes. The merchant portal cannot see or set it, so a restaurant can never
  zero out our markup. The Food Admin item form has the net-price input with
  a live "Our markup: SAR X" hint.
- Guards: server rejects `net_price > price` with a clean 400 (including
  price-only PATCHes that would undercut a stored net price, and clearing
  net_price while lowering price); a DB CHECK backstops it.

**Confidentiality (migration 0019).** RLS filters rows, not columns — the
anon key could read `net_price`, `orders.platform_margin_total`, and
`order_items.margin_*` straight from PostgREST. 0019 revokes table SELECT
from `anon`/`authenticated` and grants back every column except the money
ones; customer API responses no longer include `platform_margin_total`
(net would be derivable). Backend (service role) unaffected.

## 2. Food: settlement report + CSV

`GET /api/admin/food/settlement?from=&to=` + a "Settlement" section in Food
Admin (date range, on-screen per-restaurant summary, Download CSV).

- Per order: `restaurant_payout` (= sum of net prices), `platform_markup`,
  `delivery_fee`, `total`, `collected_by`.
- `collected_by`: `platform_online` (stcpay/tap — we hold the cash and OWE
  the restaurant their payout) vs `cash_rider` (rider collected at the door —
  the markup is owed to us). Only `paid` orders move money in the rollups;
  refunded orders are surfaced separately (`refundedAmount`).
- Cash orders now become `paid` when the ADMIN fallback marks them delivered
  (previously only the rider flow did this — admin-delivered cash orders
  stayed `awaiting` forever and vanished from settlement totals).
- Export paginates past Supabase's 1000-row cap; the date range is capped at
  400 days. CSV columns: order_code, date, merchant, subtotal,
  restaurant_payout, platform_markup, delivery_fee, total, payment_method,
  payment_status, collected_by.

## 3. Maps: street-following routes everywhere

Root cause of the "line over buildings": OSRM routing existed but pointed at
the rate-limited public demo server, silently failing to a straight line —
and only the passenger map used it at all.

- New `RoutedRideMap` component fetches the real road geometry between two
  points and falls back to a straight line when routing is down. Driver and
  food tracking maps now follow streets like the passenger map.
- Route refetches only when an endpoint moves ~100m — GPS pings every 8–12s
  do NOT hammer the proxy.
- `frontend/src/portal/lib/osrm.js` now defaults to the backend proxy
  (`VITE_API_BASE + /api/osrm`), which forwards to the self-hosted OSRM on
  the VPS. No env var needed.

**VPS runbook (one-time, required for street routing in prod):**

```bash
mkdir -p /opt/osrm && cd /opt/osrm
wget https://download.geofabrik.de/asia/saudi-arabia-latest.osm.pbf
docker run --rm -v /opt/osrm:/data ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/saudi-arabia-latest.osm.pbf
docker run --rm -v /opt/osrm:/data ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/saudi-arabia-latest.osrm
docker run --rm -v /opt/osrm:/data ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/saudi-arabia-latest.osrm
docker run -d --restart unless-stopped --name osrm -p 127.0.0.1:5000:5000 \
  -v /opt/osrm:/data ghcr.io/project-osrm/osrm-backend \
  osrm-routed --algorithm mld /data/saudi-arabia-latest.osrm
# sanity check:
curl "http://127.0.0.1:5000/route/v1/driving/46.6,24.7;46.7,24.8?overview=false"
```

Bound to 127.0.0.1 only — the `/api/osrm` proxy is the sole public path.
`OSRM_URL` stays at its default. Until the container is up, maps gracefully
fall back to straight lines.

## 4. Rate limits: the "Request failed (429)" fix

The 429 was OUR OWN `express-rate-limit`, not a permissions or provider
problem: `/search`, `/reverse`, `/nearby` shared one 40/min bucket that the
chatty location picker exhausted.

- Per-endpoint buckets (search 60 / reverse 90 / nearby 60 / osrm 120), all
  returning JSON error messages the UI can show (no more bare plain-text
  429). Global cap 120 → 240/min for map-heavy screens; sensitive endpoints
  keep their own tight limiters.
- 60s in-memory lookup cache on the location endpoints (cuts our own limiter
  pressure AND external Nominatim/Overpass calls).
- Client throttling: 550ms search debounce, 3-char minimum, nearby refetch
  only after ~150m of pin movement.
- Nominatim User-Agent now identifies the site. **Deploy note:** set
  `LOCATION_API_USER_AGENT="SmartMappia/1.0 (contact: <real email>)"` in the
  backend env — Nominatim's policy requires a contact.

## 5. Location permission prompt at sign-in

Passengers and drivers get a one-time explainer + native browser prompt right
after sign-in (Permissions API + localStorage guard; never re-asks, never
prompts admin/merchant). Fixes the cold-start where the picker needed
location but the user had never been asked.

## 6. Maps: Grab-style interactive map (Leaflet -> MapLibre GL)

The raster map could not rotate, tilt, or animate. `RideMap` kept its exact
prop contract (`markers, line, height, className, legend, follow,
followTarget`) so none of its six consumers changed — only the engine did.

- Smooth WebGL vector map; rotate (drag/two-finger twist) + tilt gestures
  with a compass reset; 3D buildings extrude at street zoom (z >= 15.5).
- Brand pins ported as DOM markers (same CSS); the driver car rotates
  smoothly and keeps its 1200ms GPS glide. Route = white casing + orange
  dashes rendered under street labels. Arabic labels shaped via the RTL
  plugin.
- Lazy-loaded: maplibre-gl is its own ~280KB-gzip chunk fetched only on map
  screens; the main bundle SHRANK ~45KB gzip. WebGL2-less devices get a
  graceful in-frame placeholder.
- Tiles: OpenFreeMap `positron` by default (free, keyless, no quota).
  Optional later: self-host KSA tiles on the VPS (Planetiler
  `--area=saudi-arabia` -> `.pmtiles`, served by Nginx byte-ranges with the
  Positron style JSON + glyphs/sprites) and set `VITE_MAP_STYLE_URL` at
  build — the pmtiles protocol is already registered in the app.

## 7. Merge with Raven's work + migration renumbering

Raven's role-targeted notifications / web push / password UX (2026-07-13)
merged cleanly with this work (merge `f2e6f20`); `AuthProvider` keeps both
the sign-in location prompt and web-push unregistration on sign-out.
**Migration numbers:** 0017 = Raven's web push; the net_price migration is
**0018** and money confidentiality is **0019** (renumbered during the merge).

## Deploy checklist

1. Supabase SQL editor: run migrations **0017** (web push, Raven's), **0018**
   (net_price), **0019** (money confidentiality) — all safe to re-run.
2. VPS: stand up the OSRM container (section 3). Optional: self-hosted tiles
   (section 6).
3. Backend env: add `LOCATION_API_USER_AGENT` with a real contact email
   (plus Raven's web-push VAPID vars per backend/.env.example).
4. `npm install` in backend (web-push) and frontend (maplibre-gl/pmtiles
   replaced leaflet/react-leaflet), then the normal redeploy flow.
5. Enter Ka Inasal's net prices via Food Admin (list price = the parenthesis
   number, net price = the base number). Kuy's single-price items need no
   action (flat fallback applies until net prices are agreed).
