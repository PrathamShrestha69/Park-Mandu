# Park Mandu — Mobile app (Expo / React Native)

The Park Mandu smart-parking and traffic-monitoring service for Android and iOS. One app serves
public users and traffic police; after sign-in the user's role decides which tabs they see.
Administrators use the web app: the mobile app has no administrator screens and the API refuses
administrator sign-ins from it.

- **Public user / landowner:** Home (nearest available parking with distance and one-tap
  directions), Map (full-screen map with search, filters and a pull-up list), My Parking (5-step
  land registration with uploads, status timeline, resubmission), Notifications, Profile
- **Traffic police:** Dashboard (live stats, latest alert, CCTV map, road conditions), Cameras
  (live AI video and tracked vehicles for cameras with a detector), Alerts (take ownership, dismiss,
  navigate), Incidents (notes, resolve), Profile with duty toggle

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
  groups `(auth)`, `(public)` and `(police)` guarded by `Stack.Protected`, so a role can only
  reach its own screens.
- **Safe areas:** the tab bar grows by the device's bottom inset, and screens pushed on top of the
  tabs add that inset themselves (`src/components/tab-options.ts`), so nothing sits under the system
  navigation bar or the home indicator.
- **Location:** `src/lib/location.ts` keeps one shared device position. The app asks for permission
  once; if it is refused or unavailable, lists fall back to "available now" without distances and
  explain how to turn location on. No default position is ever assumed.
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
