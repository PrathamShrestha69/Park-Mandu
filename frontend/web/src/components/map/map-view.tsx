"use client";

import { GeolocateControl, KATHMANDU, LngLatBounds, MAP_STYLE, Map as MapLibre, Marker, NavigationControl, Popup } from "./maplibre";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import type { MarkerTone } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Shared frame for every map: hairline ring, rounded, neutral while tiles load. */
export const MAP_FRAME = "relative isolate overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/[0.08]";

export const MAP_SIZE = {
  sm: "h-52",
  md: "h-72 md:h-80",
  lg: "h-[min(62vh,560px)] min-h-[360px]",
} as const;

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
  me,
  focus,
  geolocate = false,
  children,
  label = "Map of Kathmandu Valley",
}: {
  points: MapPoint[];
  center?: [number, number];
  zoom?: number;
  size?: keyof typeof MAP_SIZE;
  className?: string;
  fitToPoints?: boolean;
  me?: { latitude: number; longitude: number } | null;
  focus?: { latitude: number; longitude: number } | null;
  geolocate?: boolean;
  children?: ReactNode;
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const markers = useRef<Marker[]>([]);
  const router = useRouter();

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
    if (geolocate) {
      map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), "top-right");
    }
    mapRef.current = map;
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
      points.forEach((p) => bounds.extend([p.longitude, p.latitude]));
      if (me) bounds.extend([me.longitude, me.latitude]);
      map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
    }
  }, [points, me, focus, fitToPoints, center, router]);

  return (
    <div className={cn(MAP_FRAME, MAP_SIZE[size], className)}>
      <div ref={container} className="map-canvas" role="region" aria-label={label} />
      {children}
    </div>
  );
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
