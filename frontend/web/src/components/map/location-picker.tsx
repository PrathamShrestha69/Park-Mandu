"use client";

import { Check, LocateFixed, MapPin, Search } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Callout, surface } from "@/components/common";
import { FieldError, useFormResult } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { reverseGeocode, searchPlaces, type Place } from "@/lib/actions/geocode";
import { cn } from "@/lib/utils";

import { MAP_FRAME, MAP_SIZE } from "./map-view";
import { KATHMANDU, MAP_STYLE, Map as MapLibre, Marker, NavigationControl } from "./maplibre";

interface Pin {
  latitude: number;
  longitude: number;
}

/**
 * Step 1 of the landowner application: drop a pin, use GPS, or search for a place.
 * Address lookups run on the server (Server Actions) — this component only handles the map UX.
 */
export function LocationPicker({
  initial,
  initialAddress,
  initialArea,
}: {
  initial: Pin | null;
  initialAddress: string | null;
  initialArea: string | null;
}) {
  const state = useFormResult();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [pin, setPin] = useState<Pin | null>(
    state.values?.latitude
      ? { latitude: Number(state.values.latitude), longitude: Number(state.values.longitude) }
      : initial,
  );
  const [address, setAddress] = useState(state.values?.address ?? initialAddress ?? "");
  const [area, setArea] = useState(state.values?.area ?? initialArea ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [looking, startLookup] = useTransition();
  const [searching, startSearch] = useTransition();

  const placePin = (next: Pin, fly = false, lookup = true) => {
    setPin(next);
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      const marker = new Marker({ color: "#1f5ed9", draggable: true });
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat();
        placePin({ latitude: lat, longitude: lng });
      });
      markerRef.current = marker;
    }
    markerRef.current.setLngLat([next.longitude, next.latitude]).addTo(map);
    if (fly) map.flyTo({ center: [next.longitude, next.latitude], zoom: 17 });
    if (lookup) {
      startLookup(async () => {
        const place = await reverseGeocode(next.latitude, next.longitude);
        if (place) {
          setAddress(place.label);
          if (place.area) setArea(place.area);
        }
      });
    }
  };

  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibre({
      container: container.current,
      style: MAP_STYLE,
      center: pin ? [pin.longitude, pin.latitude] : KATHMANDU,
      zoom: pin ? 16 : 13,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("click", (e) => placePin({ latitude: e.lngLat.lat, longitude: e.lngLat.lng }));
    mapRef.current = map;
    if (pin) map.once("load", () => placePin(pin, false, false));
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return toast.error("Location is not available on this device.");
    navigator.geolocation.getCurrentPosition(
      (pos) => placePin({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }, true),
      () => toast.error("We couldn't read your location. Tap the map to place the pin instead."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const runSearch = () =>
    startSearch(async () => {
      const found = await searchPlaces(query);
      setResults(found);
      if (!found.length) toast("No places found. Try a nearby landmark or tole name.");
    });

  return (
    <div className="flex flex-col gap-4">
      <div role="search" className="flex gap-2">
        <InputGroup className="flex-1">
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder="Search a landmark, tole or street"
            aria-label="Search for a place"
          />
          <InputGroupAddon className="pl-3">
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <Button type="button" variant="outline" onClick={runSearch} disabled={searching || query.trim().length < 3}>
          {searching ? <Spinner /> : null}
          {searching ? "Searching" : "Search"}
        </Button>
      </div>
      {results.length > 0 && (
        <div className={cn(surface, "overflow-hidden")} role="listbox" aria-label="Search results">
          {results.map((place) => (
            <button
              type="button"
              role="option"
              aria-selected={false}
              key={`${place.latitude},${place.longitude}`}
              className="flex w-full items-center gap-3 border-b px-4 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
              onClick={() => {
                setResults([]);
                setAddress(place.label);
                if (place.area) setArea(place.area);
                placePin({ latitude: place.latitude, longitude: place.longitude }, true, false);
              }}
            >
              <MapPin className="size-4 shrink-0 text-muted-foreground" /> {place.label}
            </button>
          ))}
        </div>
      )}

      <div className={cn(MAP_FRAME, MAP_SIZE.md)}>
        <div ref={container} className="map-canvas" role="application" aria-label="Tap the map to place your parking location" />
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[calc(100%-4.5rem)] rounded-lg bg-card/95 px-2.5 py-1.5 text-xs font-medium shadow-sm ring-1 ring-foreground/10">
          Tap the map or drag the pin to the parking entrance
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" size="lg" onClick={useCurrentLocation}>
          <LocateFixed /> Use current location
        </Button>
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2" aria-live="polite">
          <MapPin className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 text-xs text-muted-foreground">
            GPS coordinates
            <strong className="block truncate font-mono text-[0.8125rem] font-medium text-foreground">
              {pin ? `${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}` : "Not set"}
            </strong>
          </span>
        </div>
      </div>

      <input type="hidden" name="latitude" value={pin?.latitude ?? ""} />
      <input type="hidden" name="longitude" value={pin?.longitude ?? ""} />

      <Field data-invalid={state.fields?.address ? true : undefined} className="gap-2">
        <FieldLabel htmlFor="f-address">
          Address {looking && <span className="font-normal text-muted-foreground">· looking up…</span>}
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="f-address"
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="House/plot, street, tole"
            aria-invalid={state.fields?.address ? true : undefined}
          />
          <InputGroupAddon className="pl-3">
            <MapPin />
          </InputGroupAddon>
        </InputGroup>
        <FieldError name="address" />
      </Field>
      <Field className="gap-2">
        <FieldLabel htmlFor="f-area">Area / locality</FieldLabel>
        <Input id="f-area" name="area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Baneshwor" />
      </Field>
      {pin && (
        <Callout tone="success" icon={<Check />}>
          Pin saved{address ? `: ${address}` : "."}
        </Callout>
      )}
    </div>
  );
}
