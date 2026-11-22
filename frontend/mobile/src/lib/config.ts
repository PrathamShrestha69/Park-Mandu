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

export type BaseLayer = "standard" | "satellite";

/** Keyless aerial imagery (Esri World Imagery) with road and place labels on top — same as the web app. */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
export const SATELLITE_STYLE = {
  version: 8,
  sources: {
    imagery: {
      type: "raster",
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    labels: {
      type: "raster",
      tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: "imagery", type: "raster", source: "imagery" },
    { id: "labels", type: "raster", source: "labels" },
  ],
} as const;

export const KATHMANDU = { latitude: 27.7056, longitude: 85.3206 };
