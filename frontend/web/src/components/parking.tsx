import { ChevronRight, CircleCheck, CircleX, Clock, FileText, MapPin, PenLine, SquareParking } from "lucide-react";
import Link from "next/link";

import { APPLICATION_STATUS, formatDate, formatDistance, formatPrice, walkingMinutes } from "@/lib/format";
import type { ApplicationStatus, ApplicationSummary, MapMarker, ParkingSummary, Tone } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Badge, surfaceLink } from "./common";
import type { MapPoint } from "./map/map-view";

/** Tinted tile colours shared by status thumbnails. */
export const TONE_TILE: Record<Tone, string> = {
  success: "bg-success/12 text-success-ink",
  warning: "bg-warning/18 text-warning-ink",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info-ink",
  neutral: "bg-muted text-muted-foreground",
};

export function ParkingRow({ parking, href }: { parking: ParkingSummary; href: string }) {
  const distance = formatDistance(parking.distance_m);
  const unavailable = parking.marker_tone === "red";
  const tile = unavailable ? TONE_TILE.danger : parking.marker_tone === "green" ? TONE_TILE.success : TONE_TILE.info;
  return (
    <Link href={href} className={cn(surfaceLink, "group p-4")}>
      <div className="flex items-center gap-3.5">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-lg font-heading text-lg font-semibold", tile)} aria-hidden>
          P
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-sans text-[0.9375rem] font-semibold tracking-normal">{parking.name}</h3>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[0.8125rem] text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            {distance ? `${distance} · ${walkingMinutes(parking.distance_m)}` : parking.area}
          </p>
        </div>
        <div className="shrink-0 text-right leading-none">
          {unavailable ? (
            <Badge tone="danger">{parking.is_open_now ? "Full" : "Closed"}</Badge>
          ) : (
            <>
              <strong className="font-heading text-xl font-semibold tabular-nums">{parking.available_spaces}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">spaces free</span>
            </>
          )}
        </div>
      </div>
      <div className="mt-3.5 flex items-center justify-between border-t border-dashed pt-3 text-sm">
        <span className="font-medium">{formatPrice(parking)}</span>
        <span className="inline-flex items-center gap-0.5 text-muted-foreground transition-colors group-hover:text-foreground">
          Details <ChevronRight className="size-4" />
        </span>
      </div>
    </Link>
  );
}

export function markersToPoints(markers: MapMarker[], hrefFor: (m: MapMarker) => string | undefined): MapPoint[] {
  return markers.map((m) => ({
    id: m.id,
    latitude: m.latitude,
    longitude: m.longitude,
    tone: m.tone,
    kind: m.kind,
    title: m.name,
    subtitle: m.subtitle,
    href: hrefFor(m),
    offline: m.kind === "camera" && m.status !== "live",
  }));
}

export function parkingsToPoints(parkings: ParkingSummary[]): MapPoint[] {
  return parkings.map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    tone: p.marker_tone,
    kind: "parking" as const,
    title: p.name,
    subtitle: `${p.available_spaces} of ${p.capacity} spaces · ${formatPrice(p)}`,
    href: `/parking/${p.id}`,
  }));
}

export const STATUS_ICON: Record<ApplicationStatus, React.ReactNode> = {
  draft: <PenLine />,
  submitted: <Clock />,
  under_review: <FileText />,
  changes_requested: <FileText />,
  approved: <CircleCheck />,
  rejected: <CircleX />,
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const s = APPLICATION_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function ApplicationCard({ app, href, showApplicant }: { app: ApplicationSummary; href: string; showApplicant?: boolean }) {
  const tone = APPLICATION_STATUS[app.status].tone;
  const dateLabel =
    app.status === "draft" ? `Last edited ${formatDate(app.updated_at)}` : `Submitted ${formatDate(app.submitted_at)}`;
  return (
    <Link href={href} className={cn(surfaceLink, "group flex items-center gap-4 p-4")}>
      <span className={cn("grid size-12 shrink-0 place-items-center rounded-lg [&_svg]:size-5", TONE_TILE[tone])} aria-hidden>
        {STATUS_ICON[app.status] ?? <SquareParking />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <ApplicationStatusBadge status={app.status} />
          {app.reference && <small className="font-mono text-xs text-muted-foreground">{app.reference}</small>}
        </div>
        <h3 className="mt-2 truncate font-sans text-[0.9375rem] font-semibold tracking-normal">
          {app.property_name ?? "Untitled parking location"}
        </h3>
        <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
          {showApplicant ? `${app.applicant_name} · ` : ""}
          {app.address ?? "Location not set yet"}
          {app.capacity ? ` · ${app.capacity} spaces` : ""}
        </p>
        <small className="mt-1 block text-xs text-muted-foreground/80">{dateLabel}</small>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
