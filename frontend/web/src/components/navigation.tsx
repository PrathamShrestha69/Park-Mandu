"use client";

import { ArrowLeft, CircleCheck, CornerUpRight, LoaderCircle, LocateFixed, Navigation, RefreshCw, Square, WifiOff } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { MapView, type MapPoint } from "@/components/map/map-view";
import { Button } from "@/components/ui/button";
import { getRoute } from "@/lib/actions/navigation";
import {
  GPS_MESSAGES,
  type GpsProblem,
  type LatLng,
  formatRouteDistance,
  formatTravelTime,
  hasArrived,
  rerouteReason,
} from "@/lib/navigation";
import type { DrivingRoute } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Any "Get directions" button on the page fires this; the map below answers it. */
export const DIRECTIONS_EVENT = "pm:directions";

type Phase = "idle" | "locating" | "preview" | "navigating" | "arrived";

function gpsProblem(error: GeolocationPositionError): GpsProblem {
  if (error.code === error.PERMISSION_DENIED) return "denied";
  if (error.code === error.TIMEOUT) return "timeout";
  return "unavailable";
}

/**
 * The parking page's map with in-app directions: a route from the driver's position to the parking
 * drawn on the same map (standard or satellite), distance and travel time, and live re-routing while
 * navigating. Nothing leaves Park Mandu: routes come from the Park Mandu API (OSRM).
 */
export function ParkingNavigation({
  destination,
  name,
  points,
  backHref,
}: {
  destination: LatLng;
  name: string;
  points: MapPoint[];
  backHref: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [me, setMe] = useState<LatLng | null>(null);
  const [route, setRoute] = useState<DrivingRoute | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [gps, setGps] = useState<GpsProblem | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [routing, setRouting] = useState(false);

  const phaseRef = useRef<Phase>("idle");
  const routeRef = useRef<DrivingRoute | null>(null);
  const meRef = useRef<LatLng | null>(null);
  const routedFrom = useRef<LatLng | null>(null);
  const lastRoutedAt = useRef(0);
  const inFlight = useRef(false);
  const watchId = useRef<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const fetchRoute = useCallback(
    async (from: LatLng, frame: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setRouting(true);
      try {
        const result = await getRoute(from, destination);
        if (result.ok) {
          routeRef.current = result.route;
          routedFrom.current = from;
          lastRoutedAt.current = Date.now();
          setRoute(result.route);
          setRouteError(null);
          setOffline(false);
          if (frame) setFitKey((k) => k + 1);
        } else {
          lastRoutedAt.current = Date.now(); // a failed attempt also waits before the next one
          setRouteError(result.message);
        }
      } catch {
        // The request never reached the server: the connection dropped. The last route stays on the map.
        lastRoutedAt.current = Date.now();
        const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
        setOffline(isOffline);
        setRouteError(isOffline ? null : "Directions are unavailable right now. We will try again as you move.");
      } finally {
        inFlight.current = false;
        setRouting(false);
      }
    },
    [destination],
  );

  const onPosition = useCallback(
    (position: GeolocationPosition) => {
      const here = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      meRef.current = here;
      setMe(here);
      setGps(null);
      if (phaseRef.current !== "navigating") return;
      if (hasArrived(here, destination)) {
        if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
        go("arrived");
        return;
      }
      if (rerouteReason(here, routeRef.current?.geometry ?? null, routedFrom.current, lastRoutedAt.current, Date.now())) {
        void fetchRoute(here, false);
      }
    },
    [destination, fetchRoute],
  );

  const onGpsError = useCallback((error: GeolocationPositionError) => {
    setGps(gpsProblem(error));
    // While navigating the watch keeps running: a lost fix often comes back by itself.
    if (phaseRef.current === "locating") go("idle");
  }, []);

  const preview = useCallback(() => {
    panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (!("geolocation" in navigator)) {
      setGps("unsupported");
      return;
    }
    setRouteError(null);
    go("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onPosition(position);
        go("preview");
        void fetchRoute({ latitude: position.coords.latitude, longitude: position.coords.longitude }, true);
      },
      onGpsError,
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, [fetchRoute, onGpsError, onPosition]);

  const start = () => {
    if (!("geolocation" in navigator)) {
      setGps("unsupported");
      return;
    }
    go("navigating");
    watchId.current = navigator.geolocation.watchPosition(onPosition, onGpsError, {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 20_000,
    });
    if (!routeRef.current && meRef.current) void fetchRoute(meRef.current, true);
  };

  const stop = () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    routeRef.current = null;
    routedFrom.current = null;
    setRoute(null);
    setRouteError(null);
    go("idle");
  };

  useEffect(() => {
    const onDirections = () => preview();
    const goOnline = () => {
      setOffline(false);
      if (phaseRef.current === "navigating" && meRef.current) void fetchRoute(meRef.current, false);
    };
    const goOffline = () => setOffline(true);
    window.addEventListener(DIRECTIONS_EVENT, onDirections);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener(DIRECTIONS_EVENT, onDirections);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [preview, fetchRoute]);

  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  const next = route ? (route.steps[1] ?? route.steps[0]) : null;
  const active = phase === "preview" || phase === "navigating";

  return (
    <div className="flex flex-col gap-3">
      <MapView
        points={points}
        center={[destination.longitude, destination.latitude]}
        zoom={16}
        size="md"
        className="lg:h-[min(62vh,560px)]"
        fitToPoints={false}
        me={me}
        route={active || phase === "arrived" ? (route?.geometry ?? null) : null}
        routeFitKey={fitKey}
        follow={phase === "navigating" ? me : null}
        label={`Map showing ${name}${route ? " and the route to it" : ""}`}
      >
        <Button asChild variant="outline" size="icon" className="absolute top-3 left-3 z-10 rounded-full shadow-sm">
          <Link href={backHref} aria-label="Back to parking list">
            <ArrowLeft />
          </Link>
        </Button>
        {phase === "navigating" && next && (
          <div className="absolute inset-x-3 top-3 z-10 ml-12 flex items-center gap-3 rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-lg" aria-live="polite">
            <CornerUpRight className="size-5 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{next.instruction}</p>
              <p className="text-xs text-primary-foreground/75">in {formatRouteDistance(next.distance_m)}</p>
            </div>
          </div>
        )}
      </MapView>

      <div ref={panel} id="directions" className="rounded-xl border bg-card p-4" aria-label="Directions">
        {phase === "idle" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Directions from where you are, shown on this map.</p>
            <Button onClick={preview}>
              <Navigation /> Get directions
            </Button>
          </div>
        )}

        {phase === "locating" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="size-4 animate-spin" /> Finding your location…
          </p>
        )}

        {phase === "arrived" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-success-ink" role="status">
              <CircleCheck className="size-5" /> You have arrived at {name}.
            </p>
            <Button variant="outline" onClick={stop}>
              Done
            </Button>
          </div>
        )}

        {active && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {route ? (
                <div className="flex items-baseline gap-4" aria-live="polite">
                  <span>
                    <strong className="font-heading text-2xl font-semibold">{formatTravelTime(route.duration_s)}</strong>
                    <span className="ml-1.5 text-sm text-muted-foreground">by car</span>
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">{formatRouteDistance(route.distance_m)}</span>
                  {routing && <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Updating route" />}
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  {routing ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" /> Finding the best route…
                    </>
                  ) : (
                    "No route yet."
                  )}
                </p>
              )}
              <div className="flex gap-2">
                {phase === "preview" ? (
                  <>
                    <Button variant="ghost" onClick={stop}>
                      Close
                    </Button>
                    <Button onClick={start} disabled={!me}>
                      <Navigation /> Start navigation
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={stop}>
                    <Square className="fill-current" /> Stop navigation
                  </Button>
                )}
              </div>
            </div>
            {route && route.steps.length > 0 && (
              <details className="group rounded-lg border bg-muted/40 text-sm" open={phase === "preview"}>
                <summary className="cursor-pointer px-3 py-2 font-medium">Turn-by-turn ({route.steps.length} steps)</summary>
                <ol className="max-h-56 overflow-y-auto border-t px-3 py-2">
                  {route.steps.map((step, i) => (
                    <li key={i} className={cn("flex justify-between gap-4 py-1.5", step === next && phase === "navigating" && "font-semibold")}>
                      <span>{step.instruction}</span>
                      {step.distance_m > 0 && <span className="shrink-0 text-muted-foreground">{formatRouteDistance(step.distance_m)}</span>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        )}

        {gps && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2.5 text-sm" role="alert">
            <span className="flex items-start gap-2">
              <LocateFixed className="mt-0.5 size-4 shrink-0" /> {GPS_MESSAGES[gps]}
              {phase === "navigating" && " Your last known position and route stay on the map."}
            </span>
            {gps !== "unsupported" && phase !== "navigating" && (
              <Button size="sm" variant="outline" onClick={preview}>
                Try again
              </Button>
            )}
          </div>
        )}
        {offline && (
          <p className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm" role="status">
            <WifiOff className="size-4 shrink-0" /> You are offline. The last route stays on the map and updates when you reconnect.
          </p>
        )}
        {routeError && !offline && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive" role="alert">
            <span>{routeError}</span>
            {me && (
              <Button size="sm" variant="outline" onClick={() => void fetchRoute(me, !route)} disabled={routing}>
                <RefreshCw /> Retry
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A "Get directions" button elsewhere on the page that starts directions on the map. */
export function DirectionsButton({ className }: { className?: string }) {
  return (
    <Button size="lg" className={className} onClick={() => window.dispatchEvent(new Event(DIRECTIONS_EVENT))}>
      <Navigation /> Get directions
    </Button>
  );
}
