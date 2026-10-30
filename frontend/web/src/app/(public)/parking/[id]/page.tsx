import { ArrowLeft, BadgeCheck, CalendarDays, Car, Clock, Landmark, MapPin, Navigation, Phone, SquareParking, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { MapView } from "@/components/map/map-view";
import { parkingsToPoints } from "@/components/parking";
import { Badge, KV, PageSkeleton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet } from "@/lib/api";
import { param } from "@/lib/api-query";
import { DAYS_LABEL, PARKING_TYPE_LABEL, formatDistance, formatHours, formatPrice, walkingMinutes } from "@/lib/format";
import type { ParkingDetail } from "@/lib/types";

export const metadata: Metadata = { title: "Parking details" };

async function ParkingDetailPageContent(props: PageProps<"/parking/[id]">) {
  const [{ id }, params] = await Promise.all([props.params, props.searchParams]);
  const lat = param(params, "lat");
  const lng = param(params, "lng");
  const parking = await apiGet<ParkingDetail>(`/parkings/${id}`, { lat, lng });
  const distance = formatDistance(parking.distance_m);
  const unavailable = parking.marker_tone === "red";
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${parking.latitude},${parking.longitude}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
      <div className="lg:sticky lg:top-6">
        <MapView
          points={parkingsToPoints([parking])}
          center={[parking.longitude, parking.latitude]}
          zoom={16}
          size="md"
          className="lg:h-[min(70vh,620px)]"
          fitToPoints={false}
          label={`Map showing ${parking.name}`}
        >
          <Button asChild variant="outline" size="icon" className="absolute top-3 left-3 z-10 rounded-full shadow-sm">
            <Link href={lat && lng ? `/explore?lat=${lat}&lng=${lng}` : "/explore"} aria-label="Back to parking list">
              <ArrowLeft />
            </Link>
          </Button>
        </MapView>
      </div>

      <section className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {unavailable ? (
              <Badge tone="danger">{parking.is_open_now ? "Full right now" : "Closed now"}</Badge>
            ) : (
              <Badge tone="success" live>
                Open · {parking.available_spaces} spaces
              </Badge>
            )}
            <h1 className="mt-3 text-2xl leading-tight font-semibold md:text-[2rem]">{parking.name}</h1>
            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0" /> {parking.address}
            </p>
          </div>
          {distance && (
            <div className="shrink-0 rounded-lg border bg-card px-3 py-2 text-right" title={walkingMinutes(parking.distance_m) ?? undefined}>
              <strong className="block font-heading text-lg leading-none font-semibold">{distance}</strong>
              <span className="mt-1 block text-[11px] text-muted-foreground">away</span>
            </div>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-2">
          {[
            { icon: <Clock />, label: "Operating hours", value: formatHours(parking.opens_at, parking.closes_at) },
            { icon: <SquareParking />, label: "Parking type", value: PARKING_TYPE_LABEL[parking.parking_type] },
            { icon: <Car />, label: "Availability", value: `${parking.available_spaces} of ${parking.capacity} spaces` },
            { icon: <CalendarDays />, label: "Open on", value: DAYS_LABEL[parking.available_days] },
          ].map((tile) => (
            <div key={tile.label} className="rounded-lg border bg-card p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
                {tile.icon}
                {tile.label}
              </dt>
              <dd className="mt-1 text-sm font-semibold">{tile.value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex items-center justify-between rounded-xl bg-primary px-5 py-4 text-primary-foreground">
          <span className="text-sm text-primary-foreground/70">Parking fee</span>
          <strong className="font-heading text-2xl font-semibold tracking-tight">{formatPrice(parking)}</strong>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="font-semibold">Owner / authority</CardTitle>
            {parking.is_owner_verified && (
              <CardAction>
                <Badge tone="success">
                  <BadgeCheck className="size-3" /> Verified
                </Badge>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <dl>
              <KV label="Managed by" value={parking.managed_by} />
              <KV label="Category" value={parking.category === "government" ? "Government / public parking" : "Approved private parking"} />
              {parking.land_size_sqm && <KV label="Area" value={`${parking.land_size_sqm.toLocaleString()} m²`} />}
              {parking.contact_phone && (
                <KV
                  label="Contact"
                  value={
                    <a href={`tel:${parking.contact_phone}`} className="inline-flex items-center gap-1 underline underline-offset-4">
                      <Phone className="size-3.5" /> {parking.contact_phone}
                    </a>
                  }
                />
              )}
            </dl>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild size="lg" className="sm:flex-1">
            <a href={directions} target="_blank" rel="noopener noreferrer">
              <Navigation /> Get directions
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={`/parking/${parking.id}/report`}>
              <TriangleAlert /> Report an issue
            </Link>
          </Button>
        </div>
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Landmark className="size-3.5" /> Availability is reported by the operator and may change.
        </p>
      </section>
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function ParkingDetailPage(props: PageProps<"/parking/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ParkingDetailPageContent {...props} />
    </Suspense>
  );
}
