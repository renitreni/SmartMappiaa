# Google Maps Platform migration

Status tracker for moving maps, routing, and geocoding off the self-hosted / free-public
stack (MapLibre + OpenFreeMap tiles, self-hosted OSRM, public Nominatim/Overpass) onto
**Google Maps Platform**. The app ships as a website **and** a Capacitor APK, so everything
here must work in the webview for **driver, user (passenger), and merchant**.

Last updated: 2026-07-24

## Why

- Self-hosted OSRM routing is unreliable; routes silently fell back to straight lines.
- Public Nominatim (search/reverse) and Overpass (nearby) rate-limit/ban us -> `502` errors.
- Decision: pay for Google. Because Google's terms forbid showing Places data on a
  non-Google basemap, the map **rendering** also moves from MapLibre to the Maps JavaScript API.

## What we deliberately KEEP (verified, do not rebuild)

- **Live location streaming** — Supabase Realtime Broadcast (websockets) + 8s HTTP poll
  fallback already move the driver pin smoothly. No Firebase/MQTT.
- **Dispatch / matching engine** — `backend/lib/dispatch.js` already does nearest-driver
  cascade, atomic claims, disconnect watchdogs, re-dispatch. **Google Fleet Engine is
  redundant and deferred.**
- **High-accuracy GPS** — one `useGeolocation` hook covers web (`enableHighAccuracy`) and
  native (`@capacitor/geolocation` = Android Fused Location Provider). Native permissions
  are already in `AndroidManifest.xml`.
- **Nearest-driver ranking** stays on free haversine math (Route Matrix costs per element).

## Capability map

| Capability | Was | Google product | Where |
|---|---|---|---|
| Map render (web+APK) | MapLibre + OpenFreeMap | Maps JavaScript API | `components/google/GoogleMap.jsx` |
| Markers / moving vehicle | MapLibre DOM markers | `AdvancedMarkerElement` | reuse `pinHtml.js` |
| Route line + ETA/distance | self-hosted OSRM | Routes: Compute Routes (Essentials) | `backend/routes/route.js`, `lib/osrm.js` |
| Address autocomplete | Nominatim | Places API (New) Autocomplete + Details | `backend/routes/locations.js` |
| Reverse geocode | Nominatim | Geocoding API | `backend/routes/locations.js` |
| Nearby POIs | Overpass | Places API (New) Nearby Search | `backend/routes/locations.js` |
| Road-snapped path (optional) | none | Roads API | Phase 3 (deferred) |

## Google Cloud setup (manual, one-time)

- [ ] Enable APIs: **Maps JavaScript API**, **Places API (New)**, **Geocoding API**, **Routes API** (optional: Roads API).
- [ ] Attach a billing account.
- [ ] Create a **vector Map ID** (required for `AdvancedMarkerElement`).
- [ ] **Browser key** — HTTP-referrer restricted to `smartmappia.com`, `www.smartmappia.com`,
      `http://localhost:*`, **and `https://localhost/*`** (Capacitor Android origin, or the
      APK map is blank). API-restricted to Maps JavaScript API only.
- [ ] **Server key** — IP-restricted to the VPS; API-restricted to Routes + Places + Geocoding. Backend only.
- [ ] **Billing budget + alert** (e.g. $50/mo).

## Env vars

Backend `.env`:
- [ ] `GOOGLE_MAPS_SERVER_KEY` (new)
- retired: `OSRM_URL`, `LOCATION_API_USER_AGENT`

Frontend `.env`:
- [ ] `VITE_GOOGLE_MAPS_BROWSER_KEY` (new)
- [ ] `VITE_GOOGLE_MAP_ID` (new)
- retired: `VITE_OSRM_BASE`, `VITE_MAP_STYLE_URL`

## Task checklist (code)

- [ ] Backend: `routes/route.js` Routes proxy; unmount `/api/osrm`; rename `osrmLimiter` -> `routeLimiter`.
- [ ] Backend: `routes/locations.js` -> Google Places Autocomplete + new `/details`, Geocoding reverse, Places Nearby. Keep the 60s TTL cache + limiters.
- [ ] Frontend: `lib/geo.js` add `getCurrentPositionOnce` (Capacitor-aware one-shot GPS).
- [ ] Frontend: `lib/api.js` add `locationDetails`, thread a session token through `locationSearch`.
- [ ] Frontend: `lib/osrm.js` `fetchRoute` -> call `/api/route`, decode polyline, same return shape.
- [ ] Frontend: `components/google/GoogleMap.jsx` new renderer; point `RideMap.jsx` at it.
- [ ] Frontend: `LocationPicker.jsx` -> details flow on select + Capacitor GPS via `getCurrentPositionOnce`.
- [ ] Frontend: Maps JS loaded via a self-contained script loader inside `GoogleMap.jsx` (no npm dependency added).

## Cost (from the pricing calculator; ~$0/mo at pilot scale)

| SKU | Free/mo | Notes |
|---|---|---|
| Maps JS Dynamic Maps | ~10K loads | render |
| Routes: Compute Routes Essentials | 10K requests | route + ETA |
| Places Autocomplete / Details / Nearby | per-SKU caps | Nearby + Details pricier -> keep cache + minimal field masks + session tokens |
| Geocoding (reverse) | per-SKU cap | reverse only |

Guardrails kept: LocationPicker 550ms debounce + ~150m nearby gate, backend 60s TTL cache,
all rate limiters, billing budget alert.

## Verification checklist

- [ ] Web: map renders on Book / Track / Driver / Food-track / merchant + admin pickers; brand pins + moving driver puck correct; route follows streets; distance/ETA populate; routing failure -> straight-line fallback.
- [ ] Places: Riyadh autocomplete -> pick -> coords + pin; "Use current location" reverse-geocodes; nearby dots on pin move.
- [ ] Security: only the browser key is `VITE_`-exposed; server key never in the bundle.
- [ ] APK (rebuild per ANDROID guide) for **driver**, **user**, **merchant**: map not blank, native GPS pin-drop works.
- [ ] Live path unchanged: driver moves on passenger map via Supabase Realtime; 8s poll fallback works.
- [ ] Cost: watch Cloud metrics after a test session; budget alert armed.
- [ ] Subagent audit: contracts preserved, no dead OSRM/Nominatim paths remain.

## Cleanup (after cutover)

- [ ] Remove `maplibre-gl`, `pmtiles`, `components/maplibre/`, unpkg RTL plugin.
- [ ] Stop/remove the VPS OSRM container.
