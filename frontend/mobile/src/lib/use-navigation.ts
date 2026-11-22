import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError } from "./api";
import { type GpsProblem, type LatLng, hasArrived, rerouteReason } from "./navigation";
import type { DrivingRoute } from "./types";

export type NavPhase = "idle" | "locating" | "preview" | "navigating" | "arrived";

async function ensurePermission(): Promise<GpsProblem | null> {
  if (!(await Location.hasServicesEnabledAsync().catch(() => false))) return "unavailable";
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
  return permission.granted ? null : "denied";
}

/**
 * In-app directions to one parking location: route preview, live navigation with re-routing, and
 * plain-language problems (no GPS, routing down, offline). The route is drawn by MapView.
 */
export function useParkingNavigation() {
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [phase, setPhaseState] = useState<NavPhase>("idle");
  const [me, setMe] = useState<LatLng | null>(null);
  const [route, setRoute] = useState<DrivingRoute | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [gps, setGps] = useState<GpsProblem | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [routing, setRouting] = useState(false);

  const phaseRef = useRef<NavPhase>("idle");
  const routeRef = useRef<DrivingRoute | null>(null);
  const meRef = useRef<LatLng | null>(null);
  const routedFrom = useRef<LatLng | null>(null);
  const lastRoutedAt = useRef(0);
  const inFlight = useRef(false);
  const watch = useRef<Location.LocationSubscription | null>(null);
  // Set synchronously by begin(), so the very first route request already knows where to go.
  const destRef = useRef<LatLng | null>(null);

  const setPhase = (next: NavPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const fetchRoute = useCallback(async (from: LatLng, frame: boolean) => {
    const to = destRef.current;
    if (!to || inFlight.current) return;
    inFlight.current = true;
    setRouting(true);
    try {
      const next = await api<DrivingRoute>("/routes/driving", {
        query: { from_lat: from.latitude, from_lng: from.longitude, to_lat: to.latitude, to_lng: to.longitude },
        auth: false,
      });
      routeRef.current = next;
      routedFrom.current = from;
      setRoute(next);
      setRouteError(null);
      setOffline(false);
      if (frame) setFitKey((k) => k + 1);
    } catch (error) {
      // Offline or routing down: the last route stays on the map; the next position update retries.
      if (error instanceof ApiError && error.status === 0) setOffline(true);
      else setRouteError(error instanceof ApiError ? error.message : "Directions are unavailable right now.");
    } finally {
      lastRoutedAt.current = Date.now();
      inFlight.current = false;
      setRouting(false);
    }
  }, []);

  const stopWatch = () => {
    watch.current?.remove();
    watch.current = null;
  };

  const onPosition = useCallback(
    (location: Location.LocationObject) => {
      const here = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      meRef.current = here;
      setMe(here);
      setGps(null);
      const to = destRef.current;
      if (phaseRef.current !== "navigating" || !to) return;
      if (hasArrived(here, to)) {
        stopWatch();
        setPhase("arrived");
        return;
      }
      if (rerouteReason(here, routeRef.current?.geometry ?? null, routedFrom.current, lastRoutedAt.current, Date.now())) {
        void fetchRoute(here, false);
      }
    },
    [fetchRoute],
  );

  const preview = useCallback(async () => {
    setRouteError(null);
    setPhase("locating");
    const problem = await ensurePermission();
    if (problem) {
      setGps(problem);
      setPhase("idle");
      return;
    }
    try {
      const fix =
        (await Location.getLastKnownPositionAsync({ maxAge: 30_000 }).catch(() => null)) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
      onPosition(fix);
      setPhase("preview");
      void fetchRoute({ latitude: fix.coords.latitude, longitude: fix.coords.longitude }, true);
    } catch {
      setGps("unavailable");
      setPhase("idle");
    }
  }, [fetchRoute, onPosition]);

  const start = useCallback(async () => {
    const problem = await ensurePermission();
    if (problem) {
      setGps(problem);
      return;
    }
    setPhase("navigating");
    stopWatch();
    try {
      watch.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 3_000, distanceInterval: 10 },
        onPosition,
        () => setGps("unavailable"), // the watch keeps running; a lost fix usually comes back
      );
    } catch {
      setGps("unavailable");
    }
    if (!routeRef.current && meRef.current) void fetchRoute(meRef.current, true);
  }, [fetchRoute, onPosition]);

  const stop = useCallback(() => {
    stopWatch();
    routeRef.current = null;
    routedFrom.current = null;
    setRoute(null);
    setRouteError(null);
    setOffline(false);
    setPhase("idle");
  }, []);

  /** Directions to a new destination: locate the driver and preview the route. */
  const begin = useCallback(
    (to: LatLng) => {
      stopWatch();
      destRef.current = to;
      routeRef.current = null;
      routedFrom.current = null;
      setRoute(null);
      setDestination(to);
      void preview();
    },
    [preview],
  );

  /** Leave directions entirely (closes the panel). */
  const clear = useCallback(() => {
    stopWatch();
    destRef.current = null;
    routeRef.current = null;
    routedFrom.current = null;
    setRoute(null);
    setRouteError(null);
    setGps(null);
    setOffline(false);
    setDestination(null);
    setPhase("idle");
  }, []);

  const retry = useCallback(() => {
    if (meRef.current) void fetchRoute(meRef.current, !routeRef.current);
    else void preview();
  }, [fetchRoute, preview]);

  useEffect(() => stopWatch, []);

  const showRoute = phase === "preview" || phase === "navigating" || phase === "arrived";
  return {
    destination,
    begin,
    clear,
    phase,
    me,
    route: showRoute ? route : null,
    fitKey,
    gps,
    routeError,
    offline,
    routing,
    preview,
    start,
    stop,
    retry,
  };
}
