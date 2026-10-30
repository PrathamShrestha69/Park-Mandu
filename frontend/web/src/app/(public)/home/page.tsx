import { ArrowRight, Bell, FileCheck2, Search } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { LocateMe } from "@/components/interactive";
import { MapLegend, MapView } from "@/components/map/map-view";
import { ParkingRow, markersToPoints } from "@/components/parking";
import { EmptyState, PageHead, PageSkeleton, surface } from "@/components/common";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { apiGet } from "@/lib/api";
import { param } from "@/lib/api-query";
import { getUnreadCount, getViewer } from "@/lib/dal";
import { greeting } from "@/lib/format";
import type { MapMarker, Page, ParkingSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Home" };

// Central Kathmandu (New Road) is used for distances until the browser shares a location.
const CITY_CENTRE = { lat: 27.7048, lng: 85.3117 };

function coordinate(value: string | undefined, min: number, max: number): number | null {
  const n = Number(value);
  return value && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

async function HomePageContent(props: PageProps<"/home">) {
  const params = await props.searchParams;
  const lat = coordinate(param(params, "lat"), -90, 90);
  const lng = coordinate(param(params, "lng"), -180, 180);
  const me = lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null;
  const origin = me ? { lat: me.latitude, lng: me.longitude } : CITY_CENTRE;

  const [viewer, unread, markers, nearby] = await Promise.all([
    getViewer(),
    getUnreadCount(),
    apiGet<MapMarker[]>("/parkings/map"),
    apiGet<Page<ParkingSummary>>("/parkings", {
      lat: origin.lat,
      lng: origin.lng,
      radius_m: 10_000,
      available_only: true,
      open_now: true,
      sort: "distance",
      size: 4,
    }),
  ]);
  const points = markersToPoints(markers, (m) => (m.kind === "parking" ? `/parking/${m.id}` : undefined));
  const locationQuery = me ? `?lat=${origin.lat}&lng=${origin.lng}` : "";

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
        <MapView points={points} me={me} geolocate label="Parking map of Kathmandu Valley">
          <form action="/explore" className="absolute top-3 right-14 left-3 z-10" role="search">
            {me && (
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
            items={[
              { label: "Available", className: "bg-success" },
              { label: "Government", className: "bg-info" },
              { label: "Pending", className: "bg-muted-foreground/60" },
              { label: "Unavailable", className: "bg-destructive" },
            ]}
          />
        </MapView>

        <aside className="flex flex-col gap-4" aria-labelledby="nearby-title">
          <section className={cn(surface, "p-5")}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="nearby-title" className="text-base font-semibold">
                  Nearest available
                </h2>
                <p className="text-xs text-muted-foreground">{me ? "From your location" : "From central Kathmandu"}</p>
              </div>
              <LocateMe label={me ? "Update" : "Near me"} />
            </div>
            {nearby.items.length ? (
              <div className="flex flex-col gap-3">
                {nearby.items.map((p) => (
                  <ParkingRow key={p.id} parking={p} href={`/parking/${p.id}${locationQuery}`} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<Search />} title="No open parking nearby" body="Try searching a different area of the valley." />
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
