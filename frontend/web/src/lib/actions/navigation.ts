"use server";

import { ApiError, apiRequest } from "../api";
import type { DrivingRoute } from "../types";

export type RouteResult = { ok: true; route: DrivingRoute } | { ok: false; code: string; message: string };

/** A driving route from the driver's position to a parking location (OSRM through the Park Mandu API). */
export async function getRoute(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): Promise<RouteResult> {
  const valid = [from.latitude, from.longitude, to.latitude, to.longitude].every((v) => typeof v === "number" && Number.isFinite(v));
  if (!valid) return { ok: false, code: "invalid", message: "Your location could not be read." };
  try {
    const route = await apiRequest<DrivingRoute>("/routes/driving", {
      query: { from_lat: from.latitude, from_lng: from.longitude, to_lat: to.latitude, to_lng: to.longitude },
    });
    return { ok: true, route };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: "network", message: "Directions are unavailable right now." };
  }
}
