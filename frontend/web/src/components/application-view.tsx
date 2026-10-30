import { Check, Eye, FileText, X } from "lucide-react";

import { APPLICATION_STATUS, DAYS_LABEL, DOCUMENT_LABEL, PARKING_TYPE_LABEL, formatBytes, formatDateTime, formatHours } from "@/lib/format";
import type { ApplicationDetail, DocumentKind } from "@/lib/types";
import { cn } from "@/lib/utils";

import { KV, surfaceLink } from "./common";

export function documentUrl(id: string, variant: "original" | "thumbnail" = "original") {
  return `/api/files/documents/${id}${variant === "thumbnail" ? "?variant=thumbnail" : ""}`;
}

interface Step {
  title: string;
  body: string;
  state: "complete" | "active" | "failed" | "upcoming";
}

/** Review progress derived from the application status and its event history. */
export function reviewSteps(app: ApplicationDetail): Step[] {
  const submitted = app.events.find((e) => e.kind === "submitted");
  const reviewStarted = [...app.events].reverse().find((e) => e.kind === "review_started");
  const lastResubmit = [...app.events].reverse().find((e) => e.kind === "resubmitted");
  const decision = [...app.events].reverse().find((e) => ["approved", "rejected", "changes_requested", "documents_requested"].includes(e.kind));

  const steps: Step[] = [
    {
      title: "Application received",
      body: submitted ? formatDateTime(submitted.created_at) : "Waiting for you to submit",
      state: submitted ? "complete" : "active",
    },
    {
      title: "Government review",
      body:
        app.status === "submitted"
          ? "In the queue for a parking registration officer."
          : app.status === "under_review"
            ? "Your property and documents are being assessed."
            : reviewStarted
              ? `Started ${formatDateTime(reviewStarted.created_at)}`
              : "Not started",
      state: app.status === "submitted" || app.status === "under_review" ? "active" : reviewStarted || decision ? "complete" : "upcoming",
    },
  ];

  if (app.status === "changes_requested") {
    steps.push({
      title: decision?.kind === "documents_requested" ? "Additional documents required" : "Changes requested",
      body: "Update your application using the feedback below, then resubmit.",
      state: "failed",
    });
  } else if (lastResubmit) {
    steps.push({ title: "Resubmitted", body: formatDateTime(lastResubmit.created_at), state: "complete" });
  }

  steps.push({
    title: "Site verification",
    body: "An officer may visit the site if required. You will be contacted in advance.",
    state: app.status === "approved" || app.status === "rejected" ? "complete" : "upcoming",
  });
  steps.push({
    title: app.status === "rejected" ? "Not approved" : app.status === "approved" ? "Approved and published" : "Final decision",
    body: app.decided_at ? formatDateTime(app.decided_at) : "We will notify you in the app as soon as a decision is made.",
    state: app.status === "approved" ? "complete" : app.status === "rejected" ? "failed" : "upcoming",
  });
  return steps;
}

const NODE: Record<Step["state"], string> = {
  complete: "border-success bg-success text-white",
  active: "border-foreground bg-card ring-4 ring-foreground/10",
  failed: "border-destructive bg-destructive text-white",
  upcoming: "border-border bg-card",
};

export function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => (
        <li key={step.title} className="relative flex gap-4 pb-6 last:pb-0">
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className={cn("absolute top-7 bottom-1 left-[11px] w-0.5 rounded-full", step.state === "complete" ? "bg-success" : "bg-border")}
            />
          )}
          <span aria-hidden className={cn("relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2", NODE[step.state])}>
            {step.state === "complete" ? <Check className="size-3.5" strokeWidth={3} /> : step.state === "failed" ? <X className="size-3.5" strokeWidth={3} /> : null}
          </span>
          <div className="min-w-0">
            <strong className={cn("block text-sm font-semibold", step.state === "upcoming" && "text-muted-foreground")}>{step.title}</strong>
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted-foreground">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function PropertySummary({ app }: { app: ApplicationDetail }) {
  return (
    <dl>
      <KV label="Property name" value={app.property_name} />
      <KV label="Address" value={app.address} />
      <KV label="Area" value={app.area} />
      <KV
        label="GPS"
        value={app.latitude ? <span className="font-mono text-xs">{`${app.latitude.toFixed(5)}, ${app.longitude?.toFixed(5)}`}</span> : null}
      />
      <KV label="Land size" value={app.land_size_sqm ? `${app.land_size_sqm.toLocaleString()} m²` : null} />
      <KV label="Capacity" value={app.capacity ? `${app.capacity} vehicles` : null} />
      <KV label="Parking type" value={app.parking_type ? PARKING_TYPE_LABEL[app.parking_type] : null} />
      <KV
        label="Operating hours"
        value={app.opens_at ? `${formatHours(app.opens_at, app.closes_at)}, ${app.available_days ? DAYS_LABEL[app.available_days] : ""}` : null}
      />
      <KV
        label="Pricing"
        value={app.pricing_mode === "free" ? "Free parking" : app.price_per_hour ? `NPR ${Number(app.price_per_hour).toFixed(0)} per hour` : null}
      />
    </dl>
  );
}

export function OwnerSummary({ app }: { app: ApplicationDetail }) {
  return (
    <dl>
      <KV label="Legal owner" value={app.owner_name} />
      <KV label="Phone" value={app.owner_phone} />
      <KV label="Government ID" value={app.gov_id_masked && <span className="font-mono text-xs">{app.gov_id_masked}</span>} />
      <KV label="Ownership document no." value={app.ownership_document_number} />
    </dl>
  );
}

const KIND_ORDER: DocumentKind[] = ["ownership_document", "government_id", "property_photo", "parking_photo"];

export function DocumentList({ app }: { app: ApplicationDetail }) {
  if (!app.documents.length) return <p className="text-sm text-muted-foreground">No documents uploaded.</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {KIND_ORDER.flatMap((kind) =>
        app.documents
          .filter((d) => d.kind === kind)
          .map((doc) => (
            <a
              key={doc.id}
              className={cn(surfaceLink, "group flex items-center gap-3 p-3")}
              href={documentUrl(doc.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {doc.has_thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={documentUrl(doc.id, "thumbnail")} alt="" width={40} height={40} className="size-10 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <FileText className="size-4" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-medium">{DOCUMENT_LABEL[doc.kind].title}</strong>
                <small className="block truncate text-xs text-muted-foreground">
                  {doc.content_type === "application/pdf" ? "PDF" : "Image"} · {formatBytes(doc.size_bytes)} ·{" "}
                  {doc.status === "ready" ? "Verified upload" : doc.status === "processing" ? "Processing…" : "Unreadable file"}
                </small>
              </span>
              <Eye className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
            </a>
          )),
      )}
    </div>
  );
}

export function statusTone(app: ApplicationDetail) {
  return APPLICATION_STATUS[app.status];
}
