<<<<<<< HEAD
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
=======
# Smart Mappia — Frontend

The React app for Smart Mappia's Airport Pick & Drop: the marketing site plus the rider, driver, and
admin portals. Built with **React 19 + Vite** and Tailwind, using Supabase for auth/realtime/uploads
and Leaflet (OpenStreetMap) for the maps.

## Run it

```bash
npm install
cp .env.example .env     # fill in VITE_API_BASE, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev              # http://localhost:5173
```

Start the backend separately (`cd ../backend && npm run dev`) so the app has an API to talk to.

> The frontend only ever uses the Supabase **anon/public** key. The service-role key stays in the
> backend.

## Build

```bash
npm run build           # static files land in dist/
npm run preview         # serve the build locally to check it
```

## Where to read more

- **[PORTALS.md](PORTALS.md)** — the routes, the roles, how a ride flows, the map/route, the admin
  preview, and the full file map.
- **[../docs/PILOT.md](../docs/PILOT.md)** — stand the whole thing up and run a pilot, including
  hosting it on your own server.
- **[../backend/README.md](../backend/README.md)** — the API side.
>>>>>>> 0e76961b6c844daa651302735be3f95582c61c86
