"use server";

import { cachedReverseGeocode, cachedSearchPlaces, type Place } from "../geocoding";

export type { Place };

export async function reverseGeocode(latitude: number, longitude: number): Promise<Place | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return cachedReverseGeocode(Math.round(latitude * 1e5) / 1e5, Math.round(longitude * 1e5) / 1e5);
}

export async function searchPlaces(query: string): Promise<Place[]> {
  return typeof query === "string" ? cachedSearchPlaces(query.trim().toLowerCase()) : [];
}
