// Imported only by client components (map-view, location-picker).
import "maplibre-gl/dist/maplibre-gl.css";

import { setWorkerUrl } from "maplibre-gl";

// OpenFreeMap — free, keyless vector tiles built from OpenStreetMap. Positron is the quiet grey
// basemap that lets markers carry the colour; the police console darkens it with a CSS filter.
export const MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/positron";
export const KATHMANDU: [number, number] = [85.3206, 27.7056];

// Served from /public (see scripts/copy-maplibre-worker.mjs); the bundler can't resolve it itself.
if (typeof window !== "undefined") setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export * from "maplibre-gl";
