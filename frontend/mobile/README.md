# Park Mandu — Mobile app (Expo / React Native)

The Park Mandu smart-parking and traffic-monitoring service for Android and iOS. One app serves
all three roles; after sign-in the user's role decides which tabs they see:

- **Public user / landowner:** Home (live map + nearest open parking), Map (search & filters),
  My Parking (5-step land registration with uploads, status timeline, resubmission),
  Notifications, Profile
- **Traffic police** (dark navy theme): Dashboard (live stats, latest alert, CCTV map, road
  conditions), Cameras, Alerts (take ownership, dismiss, navigate), Incidents (notes, resolve),
  Profile with duty toggle
- **Administrator:** Overview (metrics and charts), Applications (review: approve, reject,
  request changes or documents), valley Map with layers, Users (suspend/reactivate), More

## Run it

Start the backend first (`docker compose up` in `backend/`), then:

```bash
npm install
```

```bash
npx expo start
```

Scan the QR code with **Expo Go**, or press `a` for an Android emulator / `i` for the iOS
simulator. In development the app calls the API on the same machine that runs `expo start`,
port 8000, so a phone on the same Wi-Fi works without configuration. If it can't connect, allow
port 8000 through the Windows firewall, or set `EXPO_PUBLIC_API_URL` (see `.env.example`).

In development builds the sign-in screen lists demo accounts for each role (password
`ParkMandu@2026`).

| Script | Purpose |
| --- | --- |
| `npm start` | Expo dev server |
| `npm run lint` | ESLint (`expo lint`) |
| `npm run typecheck` | TypeScript |
| `npm run doctor` | `expo-doctor` dependency checks |

## How it is built

- **Expo SDK 58, React Native 0.88, Expo Router.** File-based routes in `src/app/`, with role
  groups `(auth)`, `(public)`, `(police)` and `(admin)` guarded by `Stack.Protected`, so a role
  can only reach its own screens.
- **The server does the work.** TanStack Query fetches from the API; lists use the API's
  pagination as infinite scroll (`usePaged`), and every filter, search and sort is a query
  parameter evaluated on the server. Validation errors come back from the API and are shown on
  the matching field.
- **Auth:** tokens are requested with `X-Client-Type: mobile`, stored in the device keychain or
  keystore (`expo-secure-store`), and refreshed automatically by a single shared request when
  they expire (`src/lib/api.ts`). If the session ends, the app returns to sign-in.
- **Maps:** OpenFreeMap vector tiles rendered by MapLibre GL inside a WebView
  (`src/components/map-view.tsx`), the same style as the web app. It runs in Expo Go with no
  native map SDK or API key. The landowner location step uses the same map as a draggable pin
  picker. Place search and address lookup go through the API (`/geo/search`, `/geo/reverse`),
  which caches results.
- **Uploads:** `expo-image-picker` for photos and `expo-document-picker` for PDFs, sent as
  multipart to the API. The backend worker strips photo metadata and builds thumbnails.
- **Live police data:** React Native has no built-in Server-Sent Events, so the dashboard,
  alerts and alert badge refresh every 15 seconds.

## Building for stores

```bash
npx eas-cli@latest build --profile production --platform android
```

Set `EXPO_PUBLIC_API_URL` to your HTTPS API for production builds. Push notifications need a
development or production build (not Expo Go) and `EXPO_PUSH_ENABLED=true` on the backend.
