import { ChevronRight, Clock, Gauge, Map, MapPin, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { AlertRow } from "@/components/police";
import { Badge, CctvFeed, EmptyState, PageHead, SectionTitle, PageSkeleton, surface, surfaceLink } from "@/components/common";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import { CAMERA_STATUS, TRAFFIC, formatClock, formatDateTime, timeAgo } from "@/lib/format";
import type { Alert, Camera, Page } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Camera" };

async function CameraDetailPageContent(props: PageProps<"/police/cameras/[id]">) {
  const { id } = await props.params;
  const [camera, alerts] = await Promise.all([
    apiGet<Camera>(`/cameras/${id}`),
    apiGet<Page<Alert>>("/alerts", { camera_id: id, status: "open", size: 5, sort: "severity" }),
  ]);
  const live = camera.status === "live";
  const latest = alerts.items[0];

  const facts = [
    { icon: <MapPin />, title: camera.road, body: `${camera.area} · ${camera.zone}` },
    { icon: <Clock />, title: "Last updated", body: `${formatDateTime(camera.last_heartbeat_at)} (${timeAgo(camera.last_heartbeat_at)})` },
    { icon: <Gauge />, title: `Traffic: ${TRAFFIC[camera.traffic_level].label}`, body: `Average speed ${camera.avg_speed_kmh} km/h` },
  ];

  return (
    <>
      <PageHead
        title={<span className="font-mono tracking-normal">{camera.code}</span>}
        subtitle={live ? "Live camera feed" : `Camera ${CAMERA_STATUS[camera.status].label.toLowerCase()}`}
        back="/police/cameras"
        actions={
          <Badge tone={CAMERA_STATUS[camera.status].tone} live={live}>
            {CAMERA_STATUS[camera.status].label}
          </Badge>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <section className="flex flex-col gap-2">
          <CctvFeed
            label={camera.code}
            stamp={`${camera.code} · ${formatClock(camera.last_heartbeat_at)}`}
            offline={!live}
            detection={latest ? `${latest.vehicle_type} · ${Math.round(latest.confidence * 100)}%` : undefined}
          />
          <p className="text-xs text-muted-foreground">Video preview placeholder. Stream source: secure CCTV network ({camera.zone}).</p>
        </section>
        <section className="flex flex-col gap-3">
          <div className={cn(surface, "p-5")}>
            <h2 className="text-lg font-semibold">{camera.name}</h2>
            <ul className="mt-4 flex flex-col gap-4">
              {facts.map((f) => (
                <li key={f.title} className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-info-ink [&_svg]:size-4">{f.icon}</span>
                  <div className="min-w-0">
                    <strong className="block text-sm font-medium">{f.title}</strong>
                    <p className="text-xs text-muted-foreground">{f.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <Link href={`/police/alerts?camera_id=${camera.id}`} className={cn(surfaceLink, "group flex items-center gap-4 p-4")}>
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/12 text-destructive">
              <TriangleAlert className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">Active parking violations</span>
              <strong className="block font-heading text-xl font-semibold">{camera.active_violations} detected</strong>
              <p className="text-xs text-muted-foreground">{latest ? `Latest ${timeAgo(latest.detected_at).toLowerCase()}` : "No active violations"}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="danger" size="lg">
              <Link href={`/police/alerts?camera_id=${camera.id}`}>
                <TriangleAlert /> View alerts
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={`/police?camera=${camera.id}`}>
                <Map /> On map
              </Link>
            </Button>
          </div>
        </section>
      </div>

      <SectionTitle title="Open alerts from this camera" />
      {alerts.items.length ? (
        <div className="flex flex-col gap-3">
          {alerts.items.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<TriangleAlert />} title="No open alerts" body="New detections from this camera will appear here in real time." />
      )}
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function CameraDetailPage(props: PageProps<"/police/cameras/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CameraDetailPageContent {...props} />
    </Suspense>
  );
}
