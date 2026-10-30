# Park Mandu — Web app (Next.js)

Responsive web app for the Park Mandu parking and traffic service: a sidebar layout on desktop,
bottom navigation on phones, and a dark navy monitoring theme for traffic police. It talks to
the FastAPI backend in `../../backend`.

## Run it

Start the backend first (`docker compose up` in `backend/`), then:

```bash
cp .env.example .env.local
```

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. With `DEMO_LOGIN=true` the sign-in page shows one-click demo accounts
for all three roles (password `ParkMandu@2026`).

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |

## How it is built

- **Next.js 16 App Router with Cache Components.** Layout chrome prerenders; every per-user
  section streams in behind `<Suspense>`, so navigation shows a skeleton instantly.
- **Server-first data flow.** Pages are Server Components that call the API on the server
  (`src/lib/api.ts`, server-only). Filters, search and pagination are URL query parameters the
  server forwards to the API, so the browser never filters data itself.
- **Mutations are Server Actions** (`src/lib/actions/*`), wired to forms with `useActionState`.
  The API's field errors come back next to the right inputs, and input values survive a failed
  submit.
- **Backend-for-frontend auth.** Sign-in stores the API tokens in this app's own `HttpOnly`,
  `SameSite=Lax` cookies; the browser never sees a token. `src/proxy.ts` refreshes expiring
  access tokens transparently (passing the new token to the same render), gates routes by role,
  and redirects to sign-in when a session ends. Server Actions get Next's built-in origin check.
- **Client code is UX only:** the MapLibre map, Recharts charts, location button, dialogs, upload
  picker, toasts and the live alert feed.
- **Live police alerts.** `src/app/api/stream/alerts` relays the API's Server-Sent Events stream
  using the session cookie; new detections raise a toast and refresh the page data.
- **Documents.** `src/app/api/files/documents/[id]` streams files from the API with the session's
  credentials, and the API enforces applicant/admin access.

### Maps

Maps use **MapLibre GL** with **OpenFreeMap** vector tiles (`NEXT_PUBLIC_MAP_STYLE`, default
`https://tiles.openfreemap.org/styles/liberty`). MapLibre v6 renders in a web worker that
bundlers cannot emit, so `scripts/copy-maplibre-worker.mjs` copies it to `public/maplibre/` on
`npm install`, `dev` and `build`; `src/components/map/maplibre.ts` points MapLibre at it.

## Routes

| Role | Routes |
| --- | --- |
| Everyone | `/` splash · `/login` (password or SMS code) · `/register` · `/forgot-password` · `/reset-password` |
| Public / landowner | `/home` · `/explore` · `/parking/[id]` · `/parking/[id]/report` · `/my-parking` · `/my-parking/[id]` · `/my-parking/[id]/edit/[step]` (location → property → owner → documents → review) · `/my-parking/[id]/submitted` · `/notifications` · `/profile` |
| Traffic police | `/police` · `/police/cameras` · `/police/cameras/[id]` · `/police/alerts` · `/police/alerts/[id]` · `/police/incidents` · `/police/incidents/[id]` · `/police/profile` |
| Administrator | `/admin` · `/admin/applications` · `/admin/applications/[id]` · `/admin/map` · `/admin/users` · `/admin/users/new` · `/admin/more` · `/admin/audit` |

## Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `API_URL` | server only | Backend base URL, e.g. `http://localhost:8000/api/v1` |
| `COOKIE_SECURE` | server only | `true` behind HTTPS |
| `DEMO_LOGIN` | server only | Show demo accounts on sign-in (development) |
| `NEXT_PUBLIC_MAP_STYLE` | browser | MapLibre style URL (OpenFreeMap by default) |
