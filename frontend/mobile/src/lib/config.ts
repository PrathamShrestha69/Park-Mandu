import Constants from "expo-constants";

/**
 * API base URL. Set EXPO_PUBLIC_API_URL for staging/production builds. In development we reuse the
 * host running the Expo dev server, so a phone on the same Wi-Fi reaches the Docker API on port 8000.
 */
function resolveApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return `http://${host ?? "localhost"}:8000/api/v1`;
}

export const API_URL = resolveApiUrl();

/** OpenFreeMap — free, keyless vector tiles built from OpenStreetMap (same style as the web app). */
export const MAP_STYLE = process.env.EXPO_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/positron";

export const KATHMANDU = { latitude: 27.7056, longitude: 85.3206 };
