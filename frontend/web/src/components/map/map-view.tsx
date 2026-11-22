"use client";

import { Layers, Maximize2, Minimize2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { GeolocateControl, KATHMANDU, LngLatBounds, MAP_STYLE, Map as MapLibre, Marker, NavigationControl, Popup, SATELLITE_STYLE } from "./maplibre";

import type { MarkerTone } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Shared frame for every map: hairline ring, rounded, neutral while tiles load. */
export const MAP_FRAME = "relative isolate overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/[0.08]";

export const MAP_SIZE = {
  sm: "h-52",
  md: "h-72 md:h-80",
  lg: "h-[min(62vh,560px)] min-h-[360px]",
} as const;

export type BaseLayer = "standard" | "satellite";
const LAYER_KEY = "pm-map-layer";

function savedLayer(): BaseLayer {
  try {
    return localStorage.getItem(LAYER_KEY) === "satellite" ? "satellite" : "standard";
  } catch {
    return "standard";
  }
}

const CONTROL_BUTTON =
  "grid size-9 place-items-center rounded-lg bg-card text-foreground shadow-sm ring-1 ring-foreground/10 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-4";

export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  tone: MarkerTone;
  kind: "parking" | "pending" | "rejected" | "camera" | "incident";
  title: string;
  subtitle?: string;
  href?: string;
  offline?: boolean;
}

const CAMERA_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.75 12h3.63a1 1 0 0 1 .88 1.47l-2.07 3.69a1 1 0 0 1-1.74.04L16 15"/><path d="M3 15V9a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';

function markerElement(point: MapPoint, onOpen: () => void): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  const tone = point.kind === "camera" ? "camera" : point.kind === "incident" ? "incident" : point.tone;
  // MapLibre owns the root element's transform (it positions markers with it), so the pin shape lives on a child.
  el.className = "map-marker";
  el.setAttribute("aria-label", `${point.title}${point.subtitle ? `, ${point.subtitle}` : ""}`);
  const pin = document.createElement("span");
  pin.className = cn("pin", `marker-${tone}`, point.offline && "is-offline");
  const glyph = document.createElement("span");
  if (point.kind === "camera") glyph.innerHTML = CAMERA_SVG;
  else glyph.textContent = point.kind === "incident" ? "!" : "P";
  pin.appendChild(glyph);
  el.appendChild(pin);
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    onOpen();
  });
  return el;
}

function popupContent(point: MapPoint, navigate: (href: string) => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "map-popup";
  const title = document.createElement("strong");
  title.textContent = point.title;
  root.appendChild(title);
  if (point.subtitle) {
    const sub = document.createElement("span");
    sub.textContent = point.subtitle;
    root.appendChild(sub);
  }
  if (point.href) {
    const link = document.createElement("a");
    link.href = point.href;
    link.textContent = "View details";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(point.href!);
    });
    root.appendChild(link);
  }
  return root;
}

export function MapView({
  points,
  center,
  zoom = 13,
  size = "lg",
  className,
  fitToPoints = true,
  fitCount,
  me,
  focus,
  geolocate = false,
  children,
  label = "Map of Kathmandu Valley",
  onPick,
  picked,
  controls = true,
  route,
  routeFitKey,
  follow,
}: {
  points: MapPoint[];
  center?: [number, number];
  zoom?: number;
  size?: keyof typeof MAP_SIZE;
  className?: string;
  fitToPoints?: boolean;
  /** Frame only the first N points (they arrive nearest first) instead of every marker. */
  fitCount?: number;
  me?: { latitude: number; longitude: number } | null;
  focus?: { latitude: number; longitude: number } | null;
  geolocate?: boolean;
  children?: ReactNode;
  label?: string;
  /** Called with the clicked position when the person taps an empty part of the map. */
  onPick?: (position: { latitude: number; longitude: number }) => void;
  /** A location the person selected (search result or tapped point), shown with its own pin. */
  picked?: { latitude: number; longitude: number; label?: string } | null;
  /** Full-screen and satellite buttons. */
  controls?: boolean;
  /** A route to draw, as [lng, lat] pairs (in-app navigation). Kept across standard/satellite switches. */
  route?: [number, number][] | null;
  /** Change this to frame the whole route once (e.g. when a new route starts). */
  routeFitKey?: string | number;
  /** Follow this position (navigation): the map keeps it in view as it moves. */
  follow?: { latitude: number; longitude: number } | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const markers = useRef<Marker[]>([]);
  const pickedMarker = useRef<Marker | null>(null);
  const pickRef = useRef(onPick);
  const router = useRouter();
  const [fullscreen, setFullscreen] = useState(false);
  const [layer, setLayer] = useState<BaseLayer>("standard");
  const routeRef = useRef(route);
  const lastRouteFit = useRef<string | number | undefined>(undefined);

  useEffect(() => {
    pickRef.current = onPick;
  });

  useEffect(() => {
    if (!container.current) return;
    let map: MapLibre;
    try {
      map = new MapLibre({
        container: container.current,
        style: MAP_STYLE,
        center: center ?? (focus ? [focus.longitude, focus.latitude] : KATHMANDU),
        zoom: focus ? 15 : zoom,
        attributionControl: { compact: true },
      });
    } catch {
      // No WebGL (old device / disabled GPU): show a static notice instead of the map.
      const notice = document.createElement("div");
      notice.className = "map-fallback";
      notice.textContent = "The interactive map could not be loaded on this device.";
      container.current.appendChild(notice);
      return;
    }
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("click", (event) => {
      pickRef.current?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    });
    if (geolocate) {
      map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), "top-right");
    }
    mapRef.current = map;
    // A style switch (standard <-> satellite) removes every layer that is not part of the style,
    // so the route is drawn again each time a style finishes loading.
    map.on("style.load", () => drawRoute(map, routeRef.current ?? null));
    const stored = savedLayer();
    if (stored === "satellite") {
      map.once("style.load", () => setLayer("satellite"));
      map.setStyle(SATELLITE_STYLE);
    }
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // The map instance is created once; markers update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];

    for (const point of points) {
      const popup = new Popup({ offset: 22, closeButton: false, maxWidth: "260px" }).setDOMContent(
        popupContent(point, (href) => router.push(href)),
      );
      const marker = new Marker({
        element: markerElement(point, () => marker.togglePopup()),
        anchor: point.kind === "camera" || point.kind === "incident" ? "center" : "bottom",
      })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(popup)
        .addTo(map);
      markers.current.push(marker);
    }
    if (me) {
      const el = document.createElement("div");
      el.className = "marker-me";
      el.setAttribute("aria-label", "Your location");
      markers.current.push(new Marker({ element: el }).setLngLat([me.longitude, me.latitude]).addTo(map));
    }

    if (focus) {
      map.jumpTo({ center: [focus.longitude, focus.latitude], zoom: 15 });
    } else if (fitToPoints && points.length > 1 && !center) {
      const bounds = new LngLatBounds();
      (fitCount ? points.slice(0, fitCount) : points).forEach((p) => bounds.extend([p.longitude, p.latitude]));
      if (me) bounds.extend([me.longitude, me.latitude]);
      map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
    }
  }, [points, me, focus, fitToPoints, fitCount, center, router]);

  useEffect(() => {
    const map = mapRef.current;
    pickedMarker.current?.remove();
    pickedMarker.current = null;
    if (!map || !picked) return;
    const el = document.createElement("div");
    el.className = "marker-picked";
    el.setAttribute("aria-label", picked.label ?? "Selected location");
    pickedMarker.current = new Marker({ element: el, anchor: "bottom" }).setLngLat([picked.longitude, picked.latitude]).addTo(map);
  }, [picked]);

  useEffect(() => {
    routeRef.current = route;
    const map = mapRef.current;
    if (!map) return;
    drawRoute(map, route ?? null);
    if (route && route.length > 1 && routeFitKey !== undefined && routeFitKey !== lastRouteFit.current) {
      lastRouteFit.current = routeFitKey;
      const bounds = new LngLatBounds();
      route.forEach((point) => bounds.extend(point));
      map.fitBounds(bounds, { padding: 70, maxZoom: 17, duration: 500 });
    }
  }, [route, routeFitKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !follow) return;
    const bounds = map.getBounds();
    // Only move when the position is about to leave the view, so the driver can still look around.
    const inner = bounds && [
      bounds.getWest() + (bounds.getEast() - bounds.getWest()) * 0.15,
      bounds.getSouth() + (bounds.getNorth() - bounds.getSouth()) * 0.15,
      bounds.getEast() - (bounds.getEast() - bounds.getWest()) * 0.15,
      bounds.getNorth() - (bounds.getNorth() - bounds.getSouth()) * 0.15,
    ];
    const outside = !inner || follow.longitude < inner[0] || follow.latitude < inner[1] || follow.longitude > inner[2] || follow.latitude > inner[3];
    if (outside) map.easeTo({ center: [follow.longitude, follow.latitude], duration: 600 });
  }, [follow]);

  // Markers are DOM elements, not style layers, so they survive a base-map switch untouched.
  const switchLayer = useCallback(() => {
    const next: BaseLayer = layer === "standard" ? "satellite" : "standard";
    mapRef.current?.setStyle(next === "satellite" ? SATELLITE_STYLE : MAP_STYLE);
    setLayer(next);
    try {
      localStorage.setItem(LAYER_KEY, next);
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  }, [layer]);

  useEffect(() => {
    // The canvas must be measured again whenever its box changes size.
    const map = mapRef.current;
    const id = requestAnimationFrame(() => map?.resize());
    if (!fullscreen) return () => cancelAnimationFrame(id);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [fullscreen]);

  return (
    <div
      ref={frame}
      className={cn(
        MAP_FRAME,
        fullscreen ? "fixed inset-0 z-[60] h-dvh rounded-none ring-0" : [MAP_SIZE[size], className],
        layer === "satellite" && "map-satellite",
        onPick && "map-pickable",
      )}
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? `${label}, full screen` : undefined}
    >
      <div ref={container} className="map-canvas" role="region" aria-label={label} />
      {controls && (
        <div className="absolute right-3 bottom-8 z-20 flex flex-col gap-2">
          <button
            type="button"
            className={CONTROL_BUTTON}
            onClick={switchLayer}
            aria-pressed={layer === "satellite"}
            aria-label={layer === "satellite" ? "Switch to standard map" : "Switch to satellite view"}
            title={layer === "satellite" ? "Standard map" : "Satellite view"}
          >
            <Layers />
          </button>
          <button
            type="button"
            className={CONTROL_BUTTON}
            onClick={() => setFullscreen((v) => !v)}
            aria-pressed={fullscreen}
            aria-label={fullscreen ? "Exit full screen" : "View map full screen"}
            title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

const ROUTE_SOURCE = "pm-route";

/** Draws (or clears) the navigation route as two line layers: a white casing and the blue route. */
function drawRoute(map: MapLibre, route: [number, number][] | null) {
  if (!map.isStyleLoaded()) return; // "style.load" draws it as soon as the style is ready
  const data: GeoJSON.Feature<GeoJSON.LineString> | GeoJSON.FeatureCollection =
    route && route.length > 1
      ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route } }
      : { type: "FeatureCollection", features: [] };
  const source = map.getSource(ROUTE_SOURCE) as import("maplibre-gl").GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(ROUTE_SOURCE, { type: "geojson", data });
  map.addLayer({
    id: "pm-route-casing",
    type: "line",
    source: ROUTE_SOURCE,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "pm-route-line",
    type: "line",
    source: ROUTE_SOURCE,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#1f5ed9", "line-width": 5 },
  });
}

/** Small key pinned to the bottom-left corner of a map. */
export function MapLegend({ items }: { items: { label: string; className: string }[] }) {
  return (
    <ul
      className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-4.5rem)] flex-wrap gap-x-3 gap-y-1 rounded-lg bg-card/95 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm ring-1 ring-foreground/10"
      aria-label="Map legend"
    >
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <i aria-hidden className={cn("inline-block size-2 rounded-full", i.className)} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
