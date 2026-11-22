import { BadgeCheck, CircleCheck, CircleX, FileText, MessageSquare, Phone } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { DocumentList, OwnerSummary, PropertySummary, Timeline, documentUrl, reviewSteps } from "@/components/application-view";
import { DecisionDialog } from "@/components/decision-dialogs";
import { MapView } from "@/components/map/map-view";
import { ApplicationStatusBadge } from "@/components/parking";
import { Badge, Callout, PageHead, SectionTitle, PageSkeleton, surface } from "@/components/common";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { startReviewAction } from "@/lib/actions/operations";
import { apiGet } from "@/lib/api";
import { DOCUMENT_LABEL, PARKING_TYPE_LABEL, formatDateTime } from "@/lib/format";
import type { ApplicationDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Application review" };

async function ApplicationReviewPageContent(props: PageProps<"/admin/applications/[id]">) {
  const { id } = await props.params;
  const app = await apiGet<ApplicationDetail>(`/admin/applications/${id}`);
  const photos = app.documents.filter((d) => d.has_thumbnail && (d.kind === "property_photo" || d.kind === "parking_photo"));
  const pending = app.status === "submitted" || app.status === "under_review";
  const initials = app.applicant_name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

  return (
    <>
      <PageHead
        title="Application review"
        subtitle={<span className="font-mono text-sm">{app.reference}</span>}
        back="/admin/applications"
        actions={<ApplicationStatusBadge status={app.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <section className="flex flex-col gap-4">
          <div className={cn(surface, "flex items-center gap-4 p-5")}>
            <Avatar className="size-14">
              <AvatarFallback className="bg-brand/12 font-heading text-lg font-semibold text-brand-ink">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <span className="text-xs text-muted-foreground">Applicant</span>
              <h2 className="truncate text-xl font-semibold">{app.applicant_name}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                {app.applicant_verified ? (
                  <Badge tone="success">
                    <BadgeCheck className="size-3" /> Verified ID
                  </Badge>
                ) : (
                  <Badge tone="warning">ID not verified</Badge>
                )}
                {app.applicant_phone && (
                  <a href={`tel:${app.applicant_phone}`} className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    <Phone className="size-3.5" /> {app.applicant_phone}
                  </a>
                )}
              </div>
              <small className="mt-1 block text-xs text-muted-foreground">Submitted {formatDateTime(app.submitted_at)}</small>
            </div>
          </div>

          {app.latitude !== null && app.longitude !== null && (
            <MapView
              points={[{ id: app.id, latitude: app.latitude, longitude: app.longitude, tone: "gray", kind: "pending", title: app.property_name ?? "Proposed parking", subtitle: app.address ?? undefined }]}
              center={[app.longitude, app.latitude]}
              zoom={16}
              fitToPoints={false}
              size="md"
              label="Proposed parking location"
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="font-semibold">Property information</CardTitle>
              <CardAction>
                <Badge tone="info">{app.parking_type ? PARKING_TYPE_LABEL[app.parking_type] : "Private land"}</Badge>
              </CardAction>
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

          <div>
            <SectionTitle title="Submitted documents" />
            <DocumentList app={app} />
          </div>

          {photos.length > 0 && (
            <div>
              <SectionTitle title="Property and parking photos" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {photos.map((photo) => (
                  <a
                    key={photo.id}
                    href={documentUrl(photo.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative block aspect-[4/3] overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={documentUrl(photo.id, "thumbnail")} alt={DOCUMENT_LABEL[photo.kind].title} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {photo.kind === "parking_photo" ? "Parking area" : "Property"}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4 lg:sticky lg:top-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-semibold">Review progress</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline steps={reviewSteps(app)} />
            </CardContent>
          </Card>

          {app.feedback && (
            <Callout tone={app.status === "approved" ? "success" : "warning"} icon={<MessageSquare />} title="Latest feedback sent">
              {app.feedback}
            </Callout>
          )}
          {app.missing.length > 0 && pending && (
            <Callout tone="warning" icon={<FileText />} title="Missing requirements">
              {app.missing.join(", ")}
            </Callout>
          )}

          {app.status === "approved" ? (
            <Callout tone="success" icon={<CircleCheck />} title="Application approved">
              Published to the public map by {app.reviewer_name}.{" "}
              {app.parking_location_id && (
                <Link href="/admin/map" className="font-semibold underline underline-offset-4">
                  View on map
                </Link>
              )}
            </Callout>
          ) : app.status === "rejected" ? (
            <Callout tone="danger" icon={<CircleX />} title="Application rejected">
              Decided by {app.reviewer_name} on {formatDateTime(app.decided_at)}.
            </Callout>
          ) : app.status === "changes_requested" ? (
            <Callout title="Waiting for the applicant">The applicant has been asked to update this application and resubmit it.</Callout>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="font-semibold">Decision</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {app.status === "submitted" && (
                  <form action={startReviewAction}>
                    <input type="hidden" name="application_id" value={app.id} />
                    <Button type="submit" variant="outline" size="lg" className="w-full">
                      Start review &amp; notify applicant
                    </Button>
                  </form>
                )}
                <DecisionDialog applicationId={app.id} decision="approve" />
                <div className="grid grid-cols-2 gap-2">
                  <DecisionDialog applicationId={app.id} decision="request_changes" />
                  <DecisionDialog applicationId={app.id} decision="request_documents" />
                </div>
                <DecisionDialog applicationId={app.id} decision="reject" />
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function ApplicationReviewPage(props: PageProps<"/admin/applications/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ApplicationReviewPageContent {...props} />
    </Suspense>
  );
}
