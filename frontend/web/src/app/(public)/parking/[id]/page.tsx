import { BadgeCheck, Bike, CalendarDays, Car, Cctv, Clock, Landmark, MapPin, Phone, SquareParking, TicketCheck, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { BookParking } from "@/components/booking";
import { DirectionsButton, ParkingNavigation } from "@/components/navigation";
import { AvailabilityBadge, OccupancyBar, parkingsToPoints } from "@/components/parking";
import { Badge, Callout, KV, PageSkeleton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiGet, apiRequest } from "@/lib/api";
import { param } from "@/lib/api-query";
import { DAYS_LABEL, PARKING_TYPE_LABEL, formatDistance, formatHours, formatPrice, vehicleTypesLabel, walkingMinutes } from "@/lib/format";
import type { BookingQuote, ParkingDetail } from "@/lib/types";

/** Price and bookable spaces for paid parking; a plain sentence instead when it cannot be booked now. */
async function loadQuote(parking: ParkingDetail): Promise<BookingQuote | string | null> {
  if (parking.pricing_mode !== "hourly" || !parking.price_per_hour) return null;
  try {
    return await apiRequest<BookingQuote>(`/parkings/${parking.id}/booking-quote`, { query: { hours: 1 } });
  } catch (error) {
    return error instanceof ApiError ? error.message : "Online booking is unavailable right now.";
  }
}

export const metadata: Metadata = { title: "Parking details" };

async function ParkingDetailPageContent(props: PageProps<"/parking/[id]">) {
  const [{ id }, params] = await Promise.all([props.params, props.searchParams]);
  const lat = param(params, "lat");
  const lng = param(params, "lng");
  const parking = await apiGet<ParkingDetail>(`/parkings/${id}`, { lat, lng });
  const distance = formatDistance(parking.distance_m);
  const quote = await loadQuote(parking);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
      <div className="lg:sticky lg:top-6">
        <ParkingNavigation
          destination={{ latitude: parking.latitude, longitude: parking.longitude }}
          name={parking.name}
          points={parkingsToPoints([parking])}
          backHref={lat && lng ? `/explore?lat=${lat}&lng=${lng}` : "/explore"}
        />
      </div>

      <section className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <AvailabilityBadge parking={parking} live />
              <Badge tone="info">{parking.parking_type_label}</Badge>
            </span>
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
            { icon: <SquareParking />, label: "Parking type", value: `${PARKING_TYPE_LABEL[parking.parking_type]} · ${parking.category === "government" ? "Government" : "Private"}` },
            {
              icon: <Car />,
              label: "Free spaces",
              value: (
                <span className="flex flex-col gap-1.5">
                  <span>
                    {parking.available_spaces} of {parking.capacity} free · {parking.occupied_spaces} taken
                  </span>
                  <OccupancyBar parking={parking} />
                </span>
              ),
            },
            { icon: <CalendarDays />, label: "Open on", value: DAYS_LABEL[parking.available_days] },
            { icon: <Bike />, label: "Vehicles accepted", value: vehicleTypesLabel(parking.vehicle_types) },
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

        {quote && typeof quote === "object" && (
          <BookParking
            parkingId={parking.id}
            pricePerHour={Number(quote.price_per_hour)}
            maxHours={quote.max_hours}
            bookable={quote.bookable_spaces}
            holdMinutes={quote.hold_minutes}
            providers={quote.providers}
          />
        )}
        {typeof quote === "string" && (
          <Callout tone="info" icon={<TicketCheck />} title="Online booking">
            {quote}
          </Callout>
        )}

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
          <DirectionsButton className="sm:flex-1" />
          <Button asChild size="lg" variant="outline">
            <Link href={`/parking/${parking.id}/report`}>
              <TriangleAlert /> Report an issue
            </Link>
          </Button>
        </div>
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          {parking.occupancy_source === "camera" ? (
            <>
              <Cctv className="size-3.5" /> Free spaces are counted live by an AI camera and may change.
            </>
          ) : (
            <>
              <Landmark className="size-3.5" /> Availability is reported by the operator and may change.
            </>
          )}
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
