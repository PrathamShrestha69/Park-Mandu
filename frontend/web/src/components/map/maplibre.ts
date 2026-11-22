// Imported only by client components (map-view, location-picker).
import "maplibre-gl/dist/maplibre-gl.css";

import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";

// OpenFreeMap — free, keyless vector tiles built from OpenStreetMap. Positron is the quiet grey
// basemap that lets markers carry the colour; the police console darkens it with a CSS filter.
export const MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/positron";
export const KATHMANDU: [number, number] = [85.3206, 27.7056];

// Keyless aerial imagery (Esri World Imagery) with road and place labels on top.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
export const SATELLITE_STYLE: StyleSpecification = {
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
};

// Served from /public (see scripts/copy-maplibre-worker.mjs); the bundler can't resolve it itself.
if (typeof window !== "undefined") setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export * from "maplibre-gl";
