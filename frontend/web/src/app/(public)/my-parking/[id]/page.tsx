import { CircleCheck, Clock, FileText, MapPin, MessageSquare, PenLine, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { DocumentList, OwnerSummary, PropertySummary, Timeline, reviewSteps, statusTone } from "@/components/application-view";
import { Callout, PageHead, SectionTitle, PageSkeleton, surface } from "@/components/common";
import { ApplicationStatusBadge, TONE_TILE } from "@/components/parking";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteDraftAction } from "@/lib/actions/applications";
import { apiGet } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { ApplicationDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Application status" };

async function ApplicationStatusPageContent(props: PageProps<"/my-parking/[id]">) {
  const { id } = await props.params;
  const app = await apiGet<ApplicationDetail>(`/applications/${id}`);
  const tone = statusTone(app).tone;
  const editable = app.status === "draft" || app.status === "changes_requested";
  const resumeStep = app.status === "changes_requested" ? "review" : ["location", "property", "owner", "documents", "review"][Math.min(app.completed_step, 4)];

  return (
    <div className="w-full max-w-3xl">
      <PageHead title="Application status" subtitle={app.reference ?? "Draft — not submitted yet"} back="/my-parking" />

      <section className={cn(surface, "flex items-center gap-4 p-5")}>
        <span className={cn("grid size-14 shrink-0 place-items-center rounded-xl [&_svg]:size-6", TONE_TILE[tone])} aria-hidden>
          {app.status === "approved" ? <CircleCheck /> : app.status === "draft" ? <PenLine /> : <Clock />}
        </span>
        <div className="min-w-0 flex-1">
          <ApplicationStatusBadge status={app.status} />
          <h2 className="mt-2 truncate text-xl font-semibold">{app.property_name ?? "Untitled parking location"}</h2>
          <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" /> {app.address ?? "Location not set"}
          </p>
        </div>
      </section>

      {app.feedback && (app.status === "changes_requested" || app.status === "rejected") && (
        <Callout
          className="mt-4"
          tone="danger"
          icon={<MessageSquare />}
          title={app.status === "rejected" ? "Reason from the review team" : "Feedback from the review team"}
        >
          {app.feedback}
          {app.reviewer_name && <span className="mt-1.5 block text-xs opacity-80">— {app.reviewer_name}</span>}
        </Callout>
      )}
      {app.status === "approved" && app.parking_location_id && (
        <Callout className="mt-4" tone="success" icon={<CircleCheck />} title="Your parking is live">
          It is now visible to the public on the Park Mandu map.{" "}
          <Link href={`/parking/${app.parking_location_id}`} className="font-semibold underline underline-offset-4">
            View public listing
          </Link>
        </Callout>
      )}

      {editable && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button asChild size="lg" className="sm:flex-1">
            <Link href={`/my-parking/${app.id}/edit/${resumeStep}`}>
              <PenLine /> {app.status === "draft" ? "Continue application" : "Edit and resubmit"}
            </Link>
          </Button>
          {app.status === "draft" && (
            <form action={deleteDraftAction}>
              <input type="hidden" name="application_id" value={app.id} />
              <Button type="submit" variant="ghost" size="lg" className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive">
                <Trash2 /> Delete draft
              </Button>
            </form>
          )}
        </div>
      )}

      {app.status !== "draft" && (
        <>
          <SectionTitle title="Review progress" />
          <section className={cn(surface, "p-5")}>
            <Timeline steps={reviewSteps(app)} />
          </section>
        </>
      )}

      <SectionTitle title="Submitted details" />
      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="font-semibold">Location & property</CardTitle>
            <CardAction className="text-xs text-muted-foreground">Updated {formatDate(app.updated_at)}</CardAction>
          </CardHeader>
          <CardContent>
            <PropertySummary app={app} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-semibold">Owner information</CardTitle>
          </CardHeader>
          <CardContent>
            <OwnerSummary app={app} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-semibold">Documents</CardTitle>
            <CardAction className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="size-3.5" /> {app.documents.length} files
            </CardAction>
          </CardHeader>
          <CardContent>
            <DocumentList app={app} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function ApplicationStatusPage(props: PageProps<"/my-parking/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ApplicationStatusPageContent {...props} />
    </Suspense>
  );
}
