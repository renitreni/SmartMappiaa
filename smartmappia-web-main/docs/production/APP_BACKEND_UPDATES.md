# App vs backend updates (Capacitor) — reference

> Reference / clarification for future planning. How changes reach users once the mobile
> app (APK) is shipped, and what does or doesn't require a rebuild.

## TL;DR
- **Backend changes → instant, no app update.** The APK doesn't contain backend code; it calls the
  API over HTTPS, so server-side changes go live for everyone immediately.
- **The API URL is baked into the app** at build time → ship the app pointing at a **stable custom
  domain** so you can move/upgrade hosting later with no rebuild.
- **UI / client-code changes → rebuild the APK, or push an OTA (live) update.**
- **Native changes (plugins, permissions, deep links, icon) → full rebuild + redistribute.**

## 1. Why backend changes are free
We use a **thin-client** design: the backend creates payments, runs business logic, and confirms
payment via webhook; the app just calls `/api/...` and shows results. So fixing/changing the payment
flow, swapping the gateway, changing rules, etc. are **all server-side** and reach every installed
app instantly — **no app rebuild, no store release.**

## 2. The one gotcha: the baked-in URL → use a stable domain
`VITE_API_BASE` (and `VITE_OSRM_BASE`) are compiled into the web bundle at build time:
- Changing backend **code/logic** → no app update needed.
- Changing the backend **URL** (e.g. moving Vercel → Hostinger) → would need a new build, **unless**
  the app points at a stable domain.

**Do this before building the APK:** point the app at a stable custom domain like
`https://api.smartmappia.com`, and aim that domain at whichever host you want (Vercel now, Hostinger
later). Then infra moves need **zero app rebuilds**. Same idea for OSRM — if you proxy it through the
backend, the app only ever knows `/api/...` (no separate OSRM URL baked in).

## 3. What does require a new APK
- **App UI / client code changes** (new screens, layout, client logic) — rebuild the APK, **or** set
  up **OTA / live updates** (Capacitor Live Updates / Appflow, or capgo) to push JS/HTML/CSS to
  installed apps without a store release. (OTA can't change native code.)
- **Native changes** — adding a Capacitor plugin, permissions, the app icon, or the deep-link scheme
  → full rebuild + redistribute through the store / sideload.

## 4. Recommendations before shipping the APK
- Ship pointing at a **stable backend domain** (not the raw `*.vercel.app`/`*.hostinger` URL).
- Keep the client **thin** so most future changes are backend-only.
- Consider wiring **OTA/live updates** early, so UI fixes don't require store releases.
- Rely on the **payment webhook** as the source of truth (so payment confirmation never depends on
  the mobile redirect succeeding — see [PICK_AND_DROP.md](PICK_AND_DROP.md) section 1 / Tap Payments).

## Related
- [PICK_AND_DROP.md](PICK_AND_DROP.md) — Tap Payments + OSRM/routing (section 3), notifications
  (section 1), and the Capacitor decision + build recipe (section 5).
