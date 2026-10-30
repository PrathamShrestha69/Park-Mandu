import { CircleCheck, MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { ActionForm, FormAlert, SubmitButton, TextAreaField, TextField } from "@/components/forms";
import { MapView } from "@/components/map/map-view";
import { Badge, Callout, CctvFeed, KV, PageHead, PageSkeleton } from "@/components/common";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addNoteAction, resolveIncidentAction } from "@/lib/actions/operations";
import { apiGet } from "@/lib/api";
import { formatClock, formatDateTime, percent, timeAgo } from "@/lib/format";
import type { IncidentDetail } from "@/lib/types";

export const metadata: Metadata = { title: "Incident" };

async function IncidentPageContent(props: PageProps<"/police/incidents/[id]">) {
  const { id } = await props.params;
  const incident = await apiGet<IncidentDetail>(`/incidents/${id}`);
  const { alert } = incident;
  const resolved = incident.status === "resolved";

  return (
    <>
      <PageHead
        title={
          <>
            Incident <span className="font-mono text-[0.85em] tracking-normal">{incident.code}</span>
          </>
        }
        subtitle={`Created ${formatDateTime(incident.created_at)}`}
        back="/police/incidents"
        actions={<Badge tone={resolved ? "success" : "warning"}>{resolved ? "Resolved" : "In progress"}</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
        <section className="flex flex-col gap-4">
          <CctvFeed label={alert.camera_code} stamp={`${alert.camera_code} · EVIDENCE ${formatClock(alert.detected_at)}`} detection={alert.plate_number ?? "Vehicle"} />
          <Card>
            <CardHeader>
              <CardTitle className="font-semibold">Incident details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <KV label="Violation" value={alert.violation_label} />
                <KV label="Location" value={`${alert.road}${alert.direction ? `, ${alert.direction.toLowerCase()}` : ""}`} />
                <KV label="Detected" value={formatDateTime(alert.detected_at)} />
                <KV label="Vehicle" value={`${alert.vehicle_color ?? ""} ${alert.vehicle_type}${alert.plate_number ? ` · ${alert.plate_number}` : ""}`} />
                <KV
                  label="CCTV source"
                  value={
                    <Link href={`/police/cameras/${alert.camera_id}`} className="font-mono text-primary underline underline-offset-4">
                      {alert.camera_code}
                    </Link>
                  }
                />
                <KV label="Detection confidence" value={percent(alert.confidence)} />
                <KV label="Handling officer" value={incident.officer_name} />
                {resolved && <KV label="Resolved" value={formatDateTime(incident.resolved_at)} />}
              </dl>
            </CardContent>
          </Card>
          <MapView
            points={[{ id: alert.id, latitude: alert.latitude, longitude: alert.longitude, tone: "incident", kind: "incident", title: alert.violation_label, subtitle: alert.road }]}
            center={[alert.longitude, alert.latitude]}
            zoom={16}
            fitToPoints={false}
            size="sm"
            label="Incident location"
          />
        </section>

        <section className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-semibold">Officer notes</CardTitle>
              <CardAction className="text-xs text-muted-foreground">{incident.notes.length} notes</CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {incident.notes.length ? (
                <ol className="flex flex-col">
                  {incident.notes.map((note) => (
                    <li className="border-b border-dashed py-3 first:pt-0 last:border-b-0" key={note.id}>
                      <p className="text-sm leading-relaxed">{note.body}</p>
                      <small className="mt-1 block text-xs text-muted-foreground">
                        {note.author_name} · {timeAgo(note.created_at)}
                      </small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MessageSquare className="size-4" /> No notes yet.
                </p>
              )}
              {!resolved && (
                <ActionForm action={addNoteAction} className="flex flex-col gap-3 border-t pt-4" key={incident.notes.length}>
                  <input type="hidden" name="incident_id" value={incident.id} />
                  <TextAreaField name="body" label="Add a note" placeholder="e.g. Driver located, vehicle being moved." rows={3} />
                  <FormAlert />
                  <SubmitButton variant="secondary" pendingLabel="Saving…">
                    Add note
                  </SubmitButton>
                </ActionForm>
              )}
            </CardContent>
          </Card>

          {resolved ? (
            <Callout tone="success" icon={<CircleCheck />} title="Incident resolved">
              {incident.resolution} Closed by {incident.officer_name} at {formatClock(incident.resolved_at)}.
            </Callout>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="font-semibold">Resolve incident</CardTitle>
              </CardHeader>
              <CardContent>
                <ActionForm action={resolveIncidentAction} className="flex flex-col gap-4">
                  <input type="hidden" name="incident_id" value={incident.id} />
                  <TextField name="resolution" label="Outcome" placeholder="Vehicle moved and road cleared." />
                  <FormAlert />
                  <SubmitButton variant="success" icon={<CircleCheck />} pendingLabel="Resolving…">
                    Mark resolved
                  </SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function IncidentPage(props: PageProps<"/police/incidents/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <IncidentPageContent {...props} />
    </Suspense>
  );
}
