import { ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";

import { setDutyAction } from "@/lib/actions/operations";
import { SEVERITY, timeAgo, titleCase } from "@/lib/format";
import type { Alert, IncidentSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Badge, LiveDot, surfaceLink } from "./common";

const STATUS_TONE = { active: "danger", assigned: "warning", resolved: "success", dismissed: "neutral" } as const;

function RowShell({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn(surfaceLink, "group flex items-center gap-3 p-4")}>
      <div className="min-w-0 flex-1">{children}</div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function AlertRow({ alert }: { alert: Alert }) {
  return (
    <RowShell href={`/police/alerts/${alert.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={SEVERITY[alert.severity].tone}>{SEVERITY[alert.severity].label}</Badge>
          <Badge tone={STATUS_TONE[alert.status]}>{titleCase(alert.status)}</Badge>
        </span>
        <small className="shrink-0 text-xs text-muted-foreground">{timeAgo(alert.detected_at)}</small>
      </div>
      <h3 className="mt-2 font-sans text-[0.9375rem] font-semibold tracking-normal">{alert.violation_label}</h3>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-muted-foreground">
        <MapPin className="size-3.5" /> {alert.road}
        <span aria-hidden>·</span>
        <span className="font-mono text-xs">{alert.camera_code}</span>
        {alert.plate_number && (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono text-xs text-foreground">{alert.plate_number}</span>
          </>
        )}
      </p>
      {alert.assigned_officer_name && <p className="mt-1 text-xs text-muted-foreground">Assigned to {alert.assigned_officer_name}</p>}
    </RowShell>
  );
}

export function IncidentRow({ incident }: { incident: IncidentSummary }) {
  const resolved = incident.status === "resolved";
  return (
    <RowShell href={`/police/incidents/${incident.id}`}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={resolved ? "success" : "warning"}>{resolved ? "Resolved" : "In progress"}</Badge>
        <small className="font-mono text-xs text-muted-foreground">{incident.code}</small>
      </div>
      <h3 className="mt-2 font-sans text-[0.9375rem] font-semibold tracking-normal">{incident.violation_label}</h3>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-muted-foreground">
        <MapPin className="size-3.5" /> {incident.road}
        <span aria-hidden>·</span>
        <span className="font-mono text-xs">{incident.camera_code}</span>
        {incident.plate_number && (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono text-xs text-foreground">{incident.plate_number}</span>
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {incident.officer_name} · opened {timeAgo(incident.created_at)}
      </p>
    </RowShell>
  );
}

/** Compact duty switch that posts to the duty Server Action. */
export function DutyToggle({ onDuty }: { onDuty: boolean }) {
  return (
    <form action={setDutyAction}>
      <input type="hidden" name="on_duty" value={onDuty ? "false" : "true"} />
      <button
        type="submit"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          onDuty ? "bg-success/15 text-success-ink hover:bg-success/25" : "bg-muted text-muted-foreground hover:text-foreground",
        )}
        aria-label={onDuty ? "On duty — tap to go off duty" : "Off duty — tap to go on duty"}
      >
        <LiveDot className={onDuty ? undefined : "animate-none"} /> {onDuty ? "On duty" : "Off duty"}
      </button>
    </form>
  );
}
