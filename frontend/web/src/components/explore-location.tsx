"use client";

import { LoaderCircle, MapPin, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { reverseGeocode, searchPlaces, type Place } from "@/lib/actions/geocode";

import { MapView, type MapPoint } from "./map/map-view";

/** Moves the search origin to a chosen place; results re-sort around it, nearest first. */
function useSetOrigin() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const setOrigin = (latitude: number, longitude: number, label: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("lat", latitude.toFixed(5));
    next.set("lng", longitude.toFixed(5));
    next.set("place", label.slice(0, 80));
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };
  const clear = () => {
    const next = new URLSearchParams(params.toString());
    ["lat", "lng", "place", "page"].forEach((k) => next.delete(k));
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };
  return { setOrigin, clear, pending };
}

/** Search an address or landmark and see the parking around it. */
export function PlaceSearch({ place }: { place?: string }) {
  const { setOrigin, clear, pending } = useSetOrigin();
  const [query, setQuery] = useState("");
  const [found, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setFailed] = useState(false);
  const listId = useId();
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchPlaces(q);
        if (ticket === latest.current) {
          setResults(found);
          setFailed(false);
          setOpen(true);
        }
      } catch {
        if (ticket === latest.current) setFailed(true);
      } finally {
        if (ticket === latest.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  // Results for a query that has since been shortened are not shown.
  const results = query.trim().length >= 3 ? found : [];
  const failed = query.trim().length >= 3 && searchFailed;

  const choose = (p: Place) => {
    setOpen(false);
    setQuery("");
    setOrigin(p.latitude, p.longitude, p.label);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <InputGroup className="h-11">
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) {
                e.preventDefault();
                choose(results[0]);
              }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search a place to see parking nearby (e.g. Durbar Marg)"
            aria-label="Search a location"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
          />
          <InputGroupAddon className="pl-3">{searching || pending ? <LoaderCircle className="animate-spin" /> : <MapPin />}</InputGroupAddon>
        </InputGroup>
        {open && (results.length > 0 || query.trim().length >= 3) && (
          <ul id={listId} role="listbox" className="absolute inset-x-0 top-12 z-30 overflow-hidden rounded-lg border bg-popover text-sm shadow-lg">
            {results.length === 0 && !searching && (
              <li className="px-3 py-2.5 text-muted-foreground">{failed ? "Place search is unavailable right now. Try again shortly." : "No places found in Nepal."}</li>
            )}
            {results.map((p) => (
              <li key={`${p.latitude},${p.longitude}`} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(p)}
                >
                  <Search className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block font-medium">{p.label}</span>
                    {p.area && <span className="block text-xs text-muted-foreground">{p.area}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {place && (
        <p className="flex items-center gap-2 text-sm">
          <MapPin className="size-4 shrink-0 text-brand" />
          <span className="min-w-0 truncate">
            Showing parking near <strong className="font-medium">{place}</strong>
          </span>
          <button type="button" onClick={clear} className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <X className="size-3.5" /> Clear
          </button>
        </p>
      )}
    </div>
  );
}

/** Results map: tap anywhere to look for parking around that exact spot. */
export function ExploreMap({
  points,
  me,
  picked,
}: {
  points: MapPoint[];
  me: { latitude: number; longitude: number } | null;
  picked: { latitude: number; longitude: number; label: string } | null;
}) {
  const { setOrigin } = useSetOrigin();
  return (
    <div className="flex flex-col gap-2">
      <MapView
        points={points}
        me={picked ? null : me}
        picked={picked}
        label="Map of search results. Tap the map to find parking near that point."
        onPick={async ({ latitude, longitude }) => {
          // Move straight away; the street name follows when the lookup returns.
          setOrigin(latitude, longitude, "Selected location");
          const place = await reverseGeocode(latitude, longitude).catch(() => null);
          if (place) setOrigin(latitude, longitude, place.label);
        }}
      />
      <p className="text-xs text-muted-foreground">Tip: tap anywhere on the map to see parking near that spot.</p>
    </div>
  );
}
