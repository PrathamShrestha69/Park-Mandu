import { Cctv, ChevronRight, CircleCheck, Siren, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { LiveAlerts } from "@/components/live-alerts";
import { MapLegend, MapView } from "@/components/map/map-view";
import { markersToPoints } from "@/components/parking";
import { DutyToggle } from "@/components/police";
import { Badge, PageHead, PageSkeleton, SectionTitle, StatCard, TextLink, surface } from "@/components/common";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { apiGet } from "@/lib/api";
import { param } from "@/lib/api-query";
import { TRAFFIC, timeAgo } from "@/lib/format";
import type { AdminMap, Camera, MapMarker, PoliceDashboard } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Traffic monitoring" };

const CONDITION: Record<string, string> = {
  clear: "bg-success ring-success/20",
  moderate: "bg-info ring-info/20",
  slow: "bg-warning ring-warning/25",
  congested: "bg-destructive ring-destructive/20",
};

async function PoliceDashboardPageContent(props: PageProps<"/police">) {
  const params = await props.searchParams;
  const focusCamera = param(params, "camera");
  const [dashboard, cameras, alertMap] = await Promise.all([
    apiGet<PoliceDashboard>("/police/dashboard"),
    apiGet<{ items: Camera[] }>("/cameras", { size: 100 }),
    apiGet<{ items: { id: string; latitude: number; longitude: number; violation_label: string; road: string; camera_code: string; severity: string }[] }>("/alerts", {
      status: "open",
      size: 100,
    }),
  ]);
  const { officer, alerts, latest_alert: latest } = dashboard;
  const focus = cameras.items.find((c) => c.id === focusCamera) ?? null;

  const markers: MapMarker[] = [
    ...cameras.items.map((c) => ({
      id: c.id,
      kind: "camera" as const,
      name: `${c.code} · ${c.name}`,
      subtitle: `${c.road} · ${c.active_violations} active violation${c.active_violations === 1 ? "" : "s"}`,
      latitude: c.latitude,
      longitude: c.longitude,
      tone: "camera" as const,
      status: c.status,
    })),
    ...alertMap.items.map((a) => ({
      id: a.id,
      kind: "incident" as const,
      name: a.violation_label,
      subtitle: `${a.road} · ${a.camera_code}`,
      latitude: a.latitude,
      longitude: a.longitude,
      tone: "incident" as const,
      status: a.severity,
    })),
  ];
  const points = markersToPoints(markers satisfies AdminMap["markers"], (m) =>
    m.kind === "camera" ? `/police/cameras/${m.id}` : `/police/alerts/${m.id}`,
  );

  return (
    <>
      <PageHead
        eyebrow="Traffic monitoring"
        title={`${officer.unit?.split("·")[1]?.trim() ?? "Kathmandu Valley"} District`}
        actions={
          <>
            <LiveAlerts />
            <div className="flex items-center gap-2.5 rounded-full border bg-card py-1 pr-1 pl-1">
              <Avatar className="size-8">
                <AvatarFallback className="bg-brand/15 text-[11px] font-semibold text-brand-ink">{officer.initials}</AvatarFallback>
              </Avatar>
              <span className="leading-tight">
                <strong className="block text-[0.8125rem] font-medium">
                  {officer.designation} {officer.full_name.split(" ").slice(-1)}
                </strong>
                <small className="block font-mono text-[11px] text-muted-foreground">{officer.badge_number}</small>
              </span>
              <DutyToggle onDuty={officer.on_duty} />
            </div>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard href="/police/alerts?status=active" icon={<TriangleAlert />} tone="red" label="Live alerts" value={alerts.open} note={`${alerts.high_priority} high priority`} />
        <StatCard
          href="/police/cameras?status=live"
          icon={<Cctv />}
          tone="blue"
          label="Cameras live"
          value={dashboard.cameras.live}
          note={`${dashboard.cameras.offline} offline · ${dashboard.cameras.maintenance} maintenance`}
        />
        <StatCard href="/police/incidents?mine=true" icon={<Siren />} tone="amber" label="My open incidents" value={dashboard.open_incidents_mine} note={`${alerts.assigned} assigned in total`} />
        <StatCard href="/police/alerts?status=resolved" icon={<CircleCheck />} tone="green" label="Resolved today" value={alerts.resolved_today} note="Across all units" />
      </div>

      {latest && (
        <Link
          href={`/police/alerts/${latest.id}`}
          className="group mt-4 flex items-center gap-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 transition-colors hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="grid size-11 shrink-0 animate-ring place-items-center rounded-full bg-destructive text-white">
            <TriangleAlert className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <Badge tone="danger">{latest.severity === "high" ? "High priority" : "New alert"}</Badge>
              <small className="text-xs text-muted-foreground">{timeAgo(latest.detected_at)}</small>
            </div>
            <h2 className="mt-1.5 text-base font-semibold">Illegal parking detected</h2>
            <p className="truncate text-[0.8125rem] text-muted-foreground">
              {latest.violation_label} · {latest.road} · Camera {latest.camera_code}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      <div className="mt-2 grid gap-x-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section>
          <SectionTitle title="Live road network" action={<TextLink href="/police/cameras">All cameras</TextLink>} />
          <MapView points={points} focus={focus ? { latitude: focus.latitude, longitude: focus.longitude } : null} label="Monitored roads with CCTV cameras and active alerts">
            <MapLegend
              items={[
                { label: "CCTV camera", className: "bg-foreground/70" },
                { label: "Active alert", className: "bg-destructive" },
              ]}
            />
          </MapView>
        </section>
        <section>
          <SectionTitle title="Road conditions" action={<TextLink href="/police/alerts">View alerts</TextLink>} />
          <ul className={cn(surface, "px-4")}>
            {dashboard.road_conditions.map((road) => (
              <li className="flex items-center gap-3 border-b py-3.5 last:border-b-0" key={road.camera_code}>
                <span className={cn("size-2.5 shrink-0 rounded-full ring-4", CONDITION[road.traffic_level])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm font-medium">{road.road}</strong>
                  <small className="text-xs text-muted-foreground">
                    {road.avg_speed_kmh} km/h avg · <span className="font-mono">{road.camera_code}</span>
                  </small>
                </div>
                <Badge tone={TRAFFIC[road.traffic_level].tone}>{TRAFFIC[road.traffic_level].label}</Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function PoliceDashboardPage(props: PageProps<"/police">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PoliceDashboardPageContent {...props} />
    </Suspense>
  );
}
