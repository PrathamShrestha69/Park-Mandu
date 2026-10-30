import { Image } from "expo-image";
import { router } from "expo-router";
import { Check, ChevronRight, CircleCheck, CircleX, Clock, FileText, MapPin, PenLine, X } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { authHeaders } from "@/lib/api";
import { API_URL } from "@/lib/config";
import {
  APPLICATION_STATUS,
  DAYS_LABEL,
  DOCUMENT_LABEL,
  PARKING_TYPE_LABEL,
  formatBytes,
  formatDate,
  formatDateTime,
  formatDistance,
  formatHours,
  formatPrice,
  walkingMinutes,
} from "@/lib/format";
import { colors, toneColors, usePalette } from "@/lib/theme";
import type { ApplicationDetail, ApplicationStatus, ApplicationSummary, ParkingSummary } from "@/lib/types";

import { Badge, Card, KV, Row, Txt } from "./ui";

export function ParkingCard({ parking, query }: { parking: ParkingSummary; query?: string }) {
  const unavailable = parking.marker_tone === "red";
  const tone = parking.marker_tone === "green" ? toneColors.success : unavailable ? toneColors.danger : toneColors.info;
  const distance = formatDistance(parking.distance_m);
  return (
    <Card onPress={() => router.push(`/parking/${parking.id}${query ?? ""}` as never)} accessibilityLabel={`${parking.name}, ${parking.available_spaces} spaces`}>
      <Row>
        <View style={[styles.icon, { backgroundColor: tone.bg }]}>
          <Txt variant="h2" color={tone.fg}>
            P
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="h3" numberOfLines={1}>
            {parking.name}
          </Txt>
          <Row gap={4} style={{ marginTop: 3 }}>
            <MapPin size={13} color={colors.slate500} />
            <Txt variant="small">{distance ? `${distance} · ${walkingMinutes(parking.distance_m)}` : parking.area}</Txt>
          </Row>
        </View>
        {unavailable ? <Badge tone="danger">{parking.is_open_now ? "Full" : "Closed"}</Badge> : <Badge tone="success">{`${parking.available_spaces} spaces`}</Badge>}
      </Row>
      <View style={styles.footer}>
        <Txt variant="h3" color={colors.green700}>
          {formatPrice(parking)}
        </Txt>
        <Row gap={2}>
          <Txt variant="label" color={colors.blue600}>
            View details
          </Txt>
          <ChevronRight size={16} color={colors.blue600} />
        </Row>
      </View>
    </Card>
  );
}

const STATUS_ICON: Record<ApplicationStatus, typeof Clock> = {
  draft: PenLine,
  submitted: Clock,
  under_review: FileText,
  changes_requested: FileText,
  approved: CircleCheck,
  rejected: CircleX,
};

export const WIZARD_STEPS = ["location", "property", "owner", "documents", "review"] as const;

/** Drafts resume at the next unfinished step; everything else opens the status screen. */
export function openApplication(app: Pick<ApplicationSummary, "id" | "status" | "completed_step">) {
  if (app.status === "draft") router.push(`/application/${app.id}/edit/${WIZARD_STEPS[Math.min(app.completed_step, 4)]}` as never);
  else router.push(`/application/${app.id}` as never);
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge tone={APPLICATION_STATUS[status].tone}>{APPLICATION_STATUS[status].label}</Badge>;
}

export function ApplicationCard({ app, onPress, showApplicant }: { app: ApplicationSummary; onPress: () => void; showApplicant?: boolean }) {
  const tone = toneColors[APPLICATION_STATUS[app.status].tone];
  const Icon = STATUS_ICON[app.status];
  return (
    <Card onPress={onPress} accessibilityLabel={`${app.property_name ?? "Untitled"}, ${APPLICATION_STATUS[app.status].label}`}>
      <Row gap={13}>
        <View style={[styles.thumb, { backgroundColor: tone.bg }]}>
          <Icon size={22} color={tone.fg} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <StatusBadge status={app.status} />
            {app.reference && <Txt variant="small">{app.reference}</Txt>}
          </Row>
          <Txt variant="h3" numberOfLines={1} style={{ marginTop: 4 }}>
            {app.property_name ?? "Untitled parking location"}
          </Txt>
          <Txt variant="small" numberOfLines={1}>
            {showApplicant ? `${app.applicant_name} · ` : ""}
            {app.address ?? "Location not set yet"}
            {app.capacity ? ` · ${app.capacity} spaces` : ""}
          </Txt>
          <Txt variant="small">{app.status === "draft" ? `Last edited ${formatDate(app.updated_at)}` : `Submitted ${formatDate(app.submitted_at)}`}</Txt>
        </View>
        <ChevronRight size={20} color={colors.slate400} />
      </Row>
    </Card>
  );
}

// --------------------------------------------------------------------------- application detail pieces

interface Step {
  title: string;
  body: string;
  state: "complete" | "active" | "failed" | "upcoming";
}

export function reviewSteps(app: ApplicationDetail): Step[] {
  const submitted = app.events.find((e) => e.kind === "submitted");
  const reviewStarted = [...app.events].reverse().find((e) => e.kind === "review_started");
  const decision = [...app.events].reverse().find((e) => ["approved", "rejected", "changes_requested", "documents_requested"].includes(e.kind));
  const steps: Step[] = [
    { title: "Application received", body: submitted ? formatDateTime(submitted.created_at) : "Waiting for you to submit", state: submitted ? "complete" : "active" },
    {
      title: "Government review",
      body: app.status === "submitted" ? "In the queue for a registration officer." : app.status === "under_review" ? "Your property and documents are being assessed." : reviewStarted ? `Started ${formatDateTime(reviewStarted.created_at)}` : "Not started",
      state: app.status === "submitted" || app.status === "under_review" ? "active" : reviewStarted || decision ? "complete" : "upcoming",
    },
  ];
  if (app.status === "changes_requested") {
    steps.push({ title: decision?.kind === "documents_requested" ? "Additional documents required" : "Changes requested", body: "Update your application using the feedback, then resubmit.", state: "failed" });
  }
  steps.push({ title: "Site verification", body: "An officer may visit the site if required.", state: app.status === "approved" || app.status === "rejected" ? "complete" : "upcoming" });
  steps.push({
    title: app.status === "rejected" ? "Not approved" : app.status === "approved" ? "Approved and published" : "Final decision",
    body: app.decided_at ? formatDateTime(app.decided_at) : "We will notify you in the app.",
    state: app.status === "approved" ? "complete" : app.status === "rejected" ? "failed" : "upcoming",
  });
  return steps;
}

export function Timeline({ steps }: { steps: Step[] }) {
  const p = usePalette();
  return (
    <View>
      {steps.map((step, i) => {
        const color = step.state === "complete" ? colors.green500 : step.state === "failed" ? colors.red500 : step.state === "active" ? colors.blue600 : colors.slate300;
        return (
          <View key={step.title} style={{ flexDirection: "row", gap: 16, minHeight: 62 }}>
            <View style={{ alignItems: "center" }}>
              <View style={[styles.dot, { borderColor: color, backgroundColor: step.state === "complete" || step.state === "failed" ? color : p.surface, borderWidth: step.state === "active" ? 6 : 2 }]}>
                {step.state === "complete" && <Check size={12} color="white" />}
                {step.state === "failed" && <X size={12} color="white" />}
              </View>
              {i < steps.length - 1 && <View style={{ flex: 1, width: 2, backgroundColor: step.state === "complete" ? colors.green500 : p.border }} />}
            </View>
            <View style={{ flex: 1, paddingBottom: 14 }}>
              <Txt variant="label">{step.title}</Txt>
              <Txt variant="small" style={{ marginTop: 3 }}>
                {step.body}
              </Txt>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function PropertySummary({ app }: { app: ApplicationDetail }) {
  return (
    <>
      <KV label="Property name" value={app.property_name} />
      <KV label="Address" value={app.address} />
      <KV label="Area" value={app.area} />
      <KV label="Land size" value={app.land_size_sqm ? `${app.land_size_sqm} m²` : null} />
      <KV label="Capacity" value={app.capacity ? `${app.capacity} vehicles` : null} />
      <KV label="Parking type" value={app.parking_type ? PARKING_TYPE_LABEL[app.parking_type] : null} />
      <KV label="Hours" value={app.opens_at ? `${formatHours(app.opens_at, app.closes_at)}${app.available_days ? `, ${DAYS_LABEL[app.available_days]}` : ""}` : null} />
      <KV label="Pricing" value={app.pricing_mode === "free" ? "Free parking" : app.price_per_hour ? `NPR ${Number(app.price_per_hour).toFixed(0)} / hour` : null} />
    </>
  );
}

export function OwnerSummary({ app }: { app: ApplicationDetail }) {
  return (
    <>
      <KV label="Legal owner" value={app.owner_name} />
      <KV label="Phone" value={app.owner_phone} />
      <KV label="Government ID" value={app.gov_id_masked} />
      <KV label="Ownership document no." value={app.ownership_document_number} />
    </>
  );
}

export const documentUrl = (id: string, variant: "original" | "thumbnail" = "thumbnail") =>
  `${API_URL}/files/documents/${id}${variant === "thumbnail" ? "?variant=thumbnail" : ""}`;

export function DocumentList({ app, onOpen }: { app: ApplicationDetail; onOpen?: (id: string) => void }) {
  const p = usePalette();
  if (!app.documents.length) return <Txt variant="muted">No documents uploaded.</Txt>;
  return (
    <View style={{ gap: 12 }}>
      {app.documents.map((doc) => (
        <Card key={doc.id} onPress={doc.has_thumbnail && onOpen ? () => onOpen(doc.id) : undefined} style={{ padding: 12, backgroundColor: p.surfaceMuted }}>
          <Row>
            {doc.has_thumbnail ? (
              <Image source={{ uri: documentUrl(doc.id), headers: authHeaders() }} style={styles.docThumb} contentFit="cover" accessibilityIgnoresInvertColors />
            ) : (
              <View style={[styles.docThumb, { alignItems: "center", justifyContent: "center", backgroundColor: colors.blue50 }]}>
                <FileText size={18} color={colors.blue700} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Txt variant="label">{DOCUMENT_LABEL[doc.kind].title}</Txt>
              <Txt variant="small">
                {doc.content_type === "application/pdf" ? "PDF" : "Image"} · {formatBytes(doc.size_bytes)} · {doc.status === "ready" ? "Ready" : doc.status === "processing" ? "Processing…" : "Unreadable"}
              </Txt>
            </View>
          </Row>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { width: 46, height: 46, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.slate100, marginTop: 12, paddingTop: 11 },
  thumb: { width: 52, height: 60, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  docThumb: { width: 42, height: 42, borderRadius: 9, backgroundColor: colors.slate100 },
});
