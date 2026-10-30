// MapLibre GL v6 renders vector tiles in a module web worker that it locates via import.meta.url.
// Bundlers don't emit that file, so we serve the installed version from /public instead.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = join(dirname(require.resolve("maplibre-gl/package.json")), "dist", "maplibre-gl-worker.mjs");
const targetDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre");

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, join(targetDir, "maplibre-gl-worker.mjs"));
console.log("maplibre worker copied to public/maplibre/");
