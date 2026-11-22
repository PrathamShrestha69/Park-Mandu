/**
 * In-app navigation rules shared by the map screens. Pure functions, no browser APIs.
 * The mobile app keeps an identical copy in frontend/mobile/src/lib/navigation.ts.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Within this distance of the parking the driver has arrived. */
export const ARRIVAL_METERS = 30;
/** Further than this from the drawn route means the driver took another road: route again. */
export const OFF_ROUTE_METERS = 60;
/** Having driven this far since the last route, it is refreshed so distance and time stay current. */
export const REFRESH_AFTER_METERS = 250;
/** Never ask for routes more often than this (the routing service is shared). */
export const MIN_REROUTE_MS = 10_000;

export function metersBetween(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

/** Shortest distance in metres from a position to a route given as [lng, lat] pairs. */
export function distanceToRoute(point: LatLng, route: [number, number][]): number {
  if (route.length === 0) return Infinity;
  // Local flat projection around the point: accurate to well under a metre at city scale.
  const k = Math.cos((point.latitude * Math.PI) / 180);
  const toXY = ([lng, lat]: [number, number]) => [(lng - point.longitude) * k * 111_320, (lat - point.latitude) * 110_574];
  let best = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, ay] = toXY(route[i]);
    const [bx, by] = toXY(route[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return route.length === 1 ? Math.hypot(...toXY(route[0])) : best;
}

export type RerouteReason = "off_route" | "refresh" | null;

/** Whether the route should be recalculated now that the driver is at `position`. */
export function rerouteReason(position: LatLng, route: [number, number][] | null, routedFrom: LatLng | null, lastRoutedAt: number, now: number): RerouteReason {
  if (!route || !routedFrom) return "refresh";
  if (now - lastRoutedAt < MIN_REROUTE_MS) return null;
  if (distanceToRoute(position, route) > OFF_ROUTE_METERS) return "off_route";
  if (metersBetween(position, routedFrom) > REFRESH_AFTER_METERS) return "refresh";
  return null;
}

export function hasArrived(position: LatLng, destination: LatLng): boolean {
  return metersBetween(position, destination) <= ARRIVAL_METERS;
}

export function formatTravelTime(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatRouteDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export type GpsProblem = "denied" | "unavailable" | "timeout" | "unsupported";

export const GPS_MESSAGES: Record<GpsProblem, string> = {
  denied: "Location access is turned off for Park Mandu. Allow location in your browser settings to get directions.",
  unavailable: "Your location could not be found. Check that location services are on, or move to an open area.",
  timeout: "Finding your location is taking too long. Check that location services are on and try again.",
  unsupported: "This device or browser cannot share its location, so directions are not available here.",
};
