import "server-only";

import { cacheLife } from "next/cache";

export interface Place {
  label: string;
  area: string | null;
  latitude: number;
  longitude: number;
}

const NOMINATIM = "https://nominatim.openstreetmap.org";
const HEADERS = { "User-Agent": "ParkMandu/1.0 (government parking registration)", "Accept-Language": "en" };

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
}

function toPlace(result: NominatimResult): Place {
  const a = result.address ?? {};
  const area = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? a.town ?? a.city ?? null;
  const parts = [a.road, a.house_number, area, a.city ?? a.town].filter(Boolean);
  return {
    label: parts.length ? parts.join(", ") : result.display_name.split(",").slice(0, 3).join(","),
    area,
    latitude: Number(result.lat),
    longitude: Number(result.lon),
  };
}

/** Address for a dropped pin. Cached server-side, so repeated lookups never hit the provider again. */
export async function cachedReverseGeocode(latitude: number, longitude: number): Promise<Place | null> {
  "use cache";
  cacheLife("weeks");
  const lat = latitude.toFixed(5);
  const lon = longitude.toFixed(5);
  try {
    const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lon}`, {
      headers: HEADERS,
    });
    if (!res.ok) return null;
    return toPlace((await res.json()) as NominatimResult);
  } catch {
    return null;
  }
}

/** Place search restricted to Nepal for the location step. */
export async function cachedSearchPlaces(query: string): Promise<Place[]> {
  "use cache";
  cacheLife("days");
  const q = query.trim().slice(0, 80);
  if (q.length < 3) return [];
  try {
    const params = new URLSearchParams({ q, format: "jsonv2", addressdetails: "1", limit: "5", countrycodes: "np" });
    const res = await fetch(`${NOMINATIM}/search?${params}`, { headers: HEADERS });
    if (!res.ok) return [];
    return ((await res.json()) as NominatimResult[]).map(toPlace);
  } catch {
    return [];
  }
}
