import { ArrowLeft, Cctv, CircleCheck, Navigation, ShieldCheck, TriangleAlert, X } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { ActionForm, FormAlert, SubmitButton, TextAreaField } from "@/components/forms";
import { Dialog } from "@/components/interactive";
import { MapView } from "@/components/map/map-view";
import { Badge, Callout, CctvFeed, LiveDot, PageSkeleton, surface } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { dismissAlertAction, handleAlertAction } from "@/lib/actions/operations";
import { apiGet } from "@/lib/api";
import { SEVERITY, formatClock, formatDateTime, percent, timeAgo } from "@/lib/format";
import type { Alert } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Illegal parking alert" };

async function AlertDetailPageContent(props: PageProps<"/police/alerts/[id]">) {
  const { id } = await props.params;
  const alert = await apiGet<Alert>(`/alerts/${id}`);
  const open = alert.status === "active";
  const navigate = `https://www.google.com/maps/dir/?api=1&destination=${alert.latitude},${alert.longitude}`;

  const pairs: { label: string; value: React.ReactNode }[] = [
    { label: "Location", value: alert.road },
    { label: "CCTV camera", value: <span className="font-mono">{alert.camera_code}</span> },
    { label: "Detection time", value: formatDateTime(alert.detected_at) },
    { label: "Severity", value: <Badge tone={SEVERITY[alert.severity].tone}>{SEVERITY[alert.severity].label}</Badge> },
    { label: "Vehicle", value: `${alert.vehicle_color ?? ""} ${alert.vehicle_type}` },
    {
      label: "License plate",
      value: alert.plate_number ? (
        <span className="inline-block rounded-md border-2 border-destructive bg-white px-2 py-0.5 font-mono text-[0.8125rem] font-semibold tracking-wide text-[#b42330]">
          {alert.plate_number}
        </span>
      ) : (
        "Not readable"
      ),
    },
    { label: "Violation type", value: alert.violation_label },
    { label: "Direction", value: alert.direction ?? "—" },
  ];
  const high = alert.confidence >= 0.85;

  return (
    <div>
      <div
        className={cn(
          "mb-6 flex items-center gap-3 rounded-xl px-3 py-3 md:px-4",
          open ? "bg-destructive text-white" : "border bg-card text-foreground",
        )}
      >
        <Button asChild variant="ghost" size="icon" className={cn("shrink-0 rounded-full", open && "bg-white/15 text-white hover:bg-white/25 hover:text-white")}>
          <Link href="/police/alerts" aria-label="Back to alerts">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <span className={cn("block text-xs font-medium tracking-wide uppercase", open ? "text-white/80" : "text-muted-foreground")}>
            {open ? "Real-time alert" : `Alert ${alert.status}`}
          </span>
          <strong className="block truncate text-sm font-semibold md:text-[0.9375rem]">
            <span className="font-mono">{alert.code}</span> · detected {timeAgo(alert.detected_at).toLowerCase()}
          </strong>
        </div>
        {open && <LiveDot className="mr-2 size-2.5" />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <header>
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold md:text-[2rem]">
              <TriangleAlert className="size-6 shrink-0 text-destructive md:size-7" /> Illegal parking detected
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {alert.violation_label} · {alert.road}
            </p>
          </header>
          {alert.has_snapshot ? (
            <figure className="overflow-hidden rounded-xl border bg-[#1a2230]">
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated proxy route, not a static asset */}
              <img
                src={`/api/files/alerts/${alert.id}/snapshot`}
                alt={`Vehicle captured by camera ${alert.camera_code}`}
                className="mx-auto max-h-96 w-full object-contain"
              />
              <figcaption className="flex justify-between bg-card px-3 py-2 font-mono text-xs text-muted-foreground">
                <span>{alert.camera_code} · {formatClock(alert.detected_at)}</span>
                <span>AI capture · {percent(alert.confidence)}</span>
              </figcaption>
            </figure>
          ) : (
            <CctvFeed
              label={alert.camera_code}
              stamp={`${alert.camera_code} · ${formatClock(alert.detected_at)}`}
              detection={`${alert.plate_number ?? "Plate unreadable"} · ${percent(alert.confidence)} match`}
            />
          )}
          <MapView
            points={[{ id: alert.id, latitude: alert.latitude, longitude: alert.longitude, tone: "incident", kind: "incident", title: alert.violation_label, subtitle: alert.road }]}
            center={[alert.longitude, alert.latitude]}
            zoom={16}
            fitToPoints={false}
            size="sm"
            label="Alert location"
          />
        </div>

        <div className="flex flex-col gap-4">
          <section className={cn(surface, "p-5")}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              {pairs.map((p) => (
                <div key={p.label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{p.label}</dt>
                  <dd className="mt-1 text-sm font-medium break-words">{p.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 border-t pt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Detection confidence</span>
                <strong className={cn("font-mono font-medium", high ? "text-destructive" : "text-warning-ink")}>
                  {percent(alert.confidence)} {high ? "high" : "medium"}
                </strong>
              </div>
              <Progress
                value={Math.round(alert.confidence * 100)}
                aria-label="Detection confidence"
                className={cn("mt-2 h-1.5", high ? "[&>div]:bg-destructive" : "[&>div]:bg-warning")}
              />
            </div>
          </section>

          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="outline" size="lg">
              <Link href={`/police/cameras/${alert.camera_id}`}>
                <Cctv /> View camera
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href={navigate} target="_blank" rel="noopener noreferrer">
                <Navigation /> Navigate
              </a>
            </Button>
          </div>

          {open ? (
            <div className="flex flex-col gap-2">
              <form action={handleAlertAction}>
                <input type="hidden" name="alert_id" value={alert.id} />
                <Button type="submit" variant="danger" size="lg" className="w-full">
                  <ShieldCheck /> Assign to me &amp; handle incident
                </Button>
              </form>
              <Dialog
                trigger={
                  <>
                    <X /> Dismiss alert
                  </>
                }
                triggerVariant="ghost"
                icon={<X />}
                title="Dismiss this alert?"
                description="Use this for false detections or authorised vehicles. The reason is kept in the audit log."
              >
                <ActionForm action={dismissAlertAction} className="flex flex-col gap-4">
                  <input type="hidden" name="alert_id" value={alert.id} />
                  <TextAreaField name="reason" label="Reason" placeholder="e.g. Authorised ambulance loading patient" rows={3} />
                  <FormAlert />
                  <SubmitButton pendingLabel="Dismissing…">Dismiss alert</SubmitButton>
                </ActionForm>
              </Dialog>
            </div>
          ) : alert.incident_id ? (
            <Button asChild size="lg">
              <Link href={`/police/incidents/${alert.incident_id}`}>
                Open incident{alert.assigned_officer_name ? ` · ${alert.assigned_officer_name}` : ""}
              </Link>
            </Button>
          ) : (
            <Callout tone="success" icon={<CircleCheck />} title={`Alert ${alert.status}`}>
              {alert.dismiss_reason ?? `Closed ${formatDateTime(alert.closed_at)}`}
            </Callout>
          )}
        </div>
      </div>
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function AlertDetailPage(props: PageProps<"/police/alerts/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlertDetailPageContent {...props} />
    </Suspense>
  );
}
