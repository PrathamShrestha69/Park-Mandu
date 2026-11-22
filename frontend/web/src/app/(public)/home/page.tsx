import { ArrowRight, Bell, FileCheck2, LocateFixed, Search } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { LocateMe } from "@/components/interactive";
import { MapLegend, MapView } from "@/components/map/map-view";
import { ParkingRow, markersToPoints } from "@/components/parking";
import { ChipLink, Chips, Dot, EmptyState, PageHead, PageSkeleton, surface } from "@/components/common";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { apiGet } from "@/lib/api";
import { param } from "@/lib/api-query";
import { getUnreadCount, getViewer } from "@/lib/dal";
import { greeting } from "@/lib/format";
import type { MapMarker, Page, ParkingSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Home" };

/** Marker filters for the home map; "available" is the default so the map is not crowded. */
const SHOW = {
  available: (m: MapMarker) => m.kind === "parking" && m.tone !== "red",
  government: (m: MapMarker) => m.kind === "parking" && m.tone === "blue",
  all: () => true,
} as const;
type Show = keyof typeof SHOW;

function coordinate(value: string | undefined, min: number, max: number): number | null {
  const n = Number(value);
  return value && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

async function HomePageContent(props: PageProps<"/home">) {
  const params = await props.searchParams;
  const lat = coordinate(param(params, "lat"), -90, 90);
  const lng = coordinate(param(params, "lng"), -180, 180);
  const me = lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null;
  // Distances are only ever measured from the visitor's real position; without one nothing is assumed.
  const origin = me ? { lat: me.latitude, lng: me.longitude } : undefined;
  const requested = param(params, "show");
  const show: Show = requested === "government" || requested === "all" ? requested : "available";

  const [viewer, unread, markers, nearby] = await Promise.all([
    getViewer(),
    getUnreadCount(),
    apiGet<MapMarker[]>("/parkings/map", origin),
    apiGet<Page<ParkingSummary>>("/parkings", {
      ...origin,
      radius_m: origin ? 20_000 : undefined,
      available_only: true,
      open_now: true,
      sort: "recommended",
      size: 4,
    }),
  ]);
  const visible = markers.filter(SHOW[show]);
  const locationQuery = origin ? `?lat=${origin.lat}&lng=${origin.lng}` : "";
  const points = markersToPoints(visible, (m) => (m.kind === "parking" ? `/parking/${m.id}${locationQuery}` : undefined));
  const chipQuery = { lat: origin?.lat, lng: origin?.lng, show: show === "available" ? undefined : show };

  return (
    <>
      <PageHead
        eyebrow={greeting()}
        title={viewer.full_name}
        actions={
          <Button asChild variant="outline" size="icon" className="relative lg:hidden">
            <Link href="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
              <Bell />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 font-mono text-[10px] font-medium text-white ring-2 ring-background tabular-nums">
                  {unread}
                </span>
              )}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-3">
        <Chips label="Parking shown on the map">
          <ChipLink basePath="/home" query={chipQuery} param="show" value={undefined} current={chipQuery.show}>
            <Dot className="bg-success" />
            Available now
          </ChipLink>
          <ChipLink basePath="/home" query={chipQuery} param="show" value="government" current={chipQuery.show}>
            <Dot className="bg-info" />
            Government
          </ChipLink>
          <ChipLink basePath="/home" query={chipQuery} param="show" value="all" current={chipQuery.show}>
            Everything
          </ChipLink>
        </Chips>
        <MapView points={points} me={me} fitCount={me ? 8 : undefined} geolocate label="Parking map of Kathmandu Valley">
          <form action="/explore" className="absolute top-3 right-14 left-3 z-10" role="search">
            {origin && (
              <>
                <input type="hidden" name="lat" value={origin.lat} />
                <input type="hidden" name="lng" value={origin.lng} />
              </>
            )}
            <InputGroup className="h-11 shadow-[0_6px_20px_-8px_rgb(0_0_0/0.25)]">
              <InputGroupInput name="q" placeholder="Search parking or location" autoComplete="off" aria-label="Search parking or location" />
              <InputGroupAddon className="pl-3">
                <Search />
              </InputGroupAddon>
            </InputGroup>
          </form>
          <MapLegend
            items={
              show === "all"
                ? [
                    { label: "Available", className: "bg-success" },
                    { label: "Government", className: "bg-info" },
                    { label: "Full or closed", className: "bg-destructive" },
                    { label: "Awaiting approval", className: "bg-muted-foreground/60" },
                  ]
                : [
                    { label: "Available", className: "bg-success" },
                    { label: "Government", className: "bg-info" },
                  ]
            }
          />
        </MapView>
        </div>

        <aside className="flex flex-col gap-4" aria-labelledby="nearby-title">
          <section className={cn(surface, "p-5")}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="nearby-title" className="text-base font-semibold">
                  {me ? "Nearest available" : "Available now"}
                </h2>
                <p className="text-xs text-muted-foreground">{me ? "Sorted by distance from you" : "Across the valley"}</p>
              </div>
              <LocateMe label={me ? "Update" : "Near me"} askOnce />
            </div>
            {!me && (
              <p className="mb-4 flex items-start gap-2 rounded-lg border border-info/20 bg-info/[0.06] px-3 py-2.5 text-xs text-info-ink">
                <LocateFixed className="mt-0.5 size-3.5 shrink-0" />
                Share your location to see the parking closest to you and how far it is. Without it you can still search by area.
              </p>
            )}
            {nearby.items.length ? (
              <div className="flex flex-col gap-3">
                {nearby.items.map((p) => (
                  <ParkingRow key={p.id} parking={p} href={`/parking/${p.id}${locationQuery}`} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<Search />} title={me ? "No open parking within 20 km" : "No parking is open right now"} body="Open the full list to see every location and its opening hours." />
            )}
            <Button asChild variant="outline" size="lg" className="mt-4 w-full">
              <Link href={`/explore${locationQuery}`}>See all parking</Link>
            </Button>
          </section>

          <Link
            href="/my-parking"
            className="group flex items-center gap-4 rounded-xl bg-primary p-5 text-primary-foreground transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-foreground/10">
              <FileCheck2 className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block font-heading text-base font-semibold">Have unused land?</strong>
              <span className="block text-sm text-primary-foreground/70">Register it as parking and submit it for approval.</span>
            </span>
            <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </aside>
      </div>
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function HomePage(props: PageProps<"/home">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HomePageContent {...props} />
    </Suspense>
  );
}
