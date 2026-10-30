import { useMutation } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Check, CircleCheck, CircleX, FilePlus2, MessageSquare, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from "react-native";

import { MapView } from "@/components/map-view";
import { DocumentList, OwnerSummary, PropertySummary, StatusBadge, Timeline, reviewSteps } from "@/components/parking";
import { Badge, Button, Callout, Card, ErrorView, Field, FormMessage, Header, Loading, Row, Screen, SectionTitle, Txt } from "@/components/ui";
import { api, formErrors } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { invalidate, queryClient, useApi } from "@/lib/queries";
import { colors } from "@/lib/theme";
import type { ApplicationDetail } from "@/lib/types";

type Decision = "approve" | "reject" | "request_changes" | "request_documents";

const COPY: Record<Decision, { title: string; body: string; confirm: string; variant: "success" | "danger" | "primary"; icon: typeof Check; tone: string }> = {
  approve: { title: "Approve this application?", body: "The location will be added to the approved register and shown on the public map.", confirm: "Confirm approval", variant: "success", icon: Check, tone: colors.green500 },
  request_changes: { title: "Request changes", body: "Explain exactly what the applicant must correct before resubmitting.", confirm: "Send request", variant: "primary", icon: MessageSquare, tone: colors.blue600 },
  request_documents: { title: "Request documents", body: "Name the documents that are missing or unclear.", confirm: "Send request", variant: "primary", icon: FilePlus2, tone: colors.blue600 },
  reject: { title: "Reject this application?", body: "Give a clear reason. It is sent to the applicant and kept in the audit log.", confirm: "Reject application", variant: "danger", icon: TriangleAlert, tone: colors.red500 },
};

export default function Review() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useApi<ApplicationDetail>(`/admin/applications/${id}`);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [feedback, setFeedback] = useState("");

  const onDone = (app: ApplicationDetail) => {
    queryClient.setQueryData([`/admin/applications/${id}`, {}], app);
    void invalidate("/admin");
  };
  const startReview = useMutation({ mutationFn: () => api<ApplicationDetail>(`/admin/applications/${id}/start-review`, { method: "POST" }), onSuccess: onDone });
  const decide = useMutation({
    mutationFn: (d: Decision) => api<ApplicationDetail>(`/admin/applications/${id}/decision`, { method: "POST", json: { decision: d, feedback: feedback || null } }),
    onSuccess: (app) => {
      onDone(app);
      setDecision(null);
      setFeedback("");
    },
  });

  if (query.isPending) return <Loading />;
  if (query.isError) return <Screen><ErrorView error={query.error} onRetry={() => query.refetch()} /></Screen>;
  const app = query.data;
  const pending = app.status === "submitted" || app.status === "under_review";
  const decideError = decide.error ? formErrors(decide.error) : null;
  const copy = decision ? COPY[decision] : null;

  return (
    <Screen refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <Header title="Application review" subtitle={app.reference ?? undefined} back right={<StatusBadge status={app.status} />} />

      <Card>
        <Row gap={12}>
          <View style={styles.avatar}>
            <Txt variant="h2" color={colors.blue700}>
              {app.applicant_name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </Txt>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Txt variant="small">Applicant</Txt>
            <Txt variant="h2">{app.applicant_name}</Txt>
            <Row gap={6}>
              <Badge tone={app.applicant_verified ? "success" : "warning"}>{app.applicant_verified ? "Verified ID" : "ID not verified"}</Badge>
              {app.applicant_phone && <Txt variant="small">{app.applicant_phone}</Txt>}
            </Row>
            <Txt variant="small">Submitted {formatDateTime(app.submitted_at)}</Txt>
          </View>
        </Row>
      </Card>

      {app.latitude !== null && app.longitude !== null && (
        <MapView height={220} style={{ marginTop: 12 }} center={{ latitude: app.latitude, longitude: app.longitude }} zoom={16} fit={false} points={[{ id: app.id, latitude: app.latitude, longitude: app.longitude, tone: "gray", kind: "pending", title: app.property_name ?? "Proposed parking", subtitle: app.address ?? undefined }]} />
      )}

      <SectionTitle title="Property information" />
      <Card>
        <PropertySummary app={app} />
      </Card>
      <SectionTitle title="Owner information" />
      <Card>
        <OwnerSummary app={app} />
      </Card>
      <SectionTitle title={`Documents & photos (${app.documents.length})`} />
      <DocumentList app={app} />

      <SectionTitle title="Review progress" />
      <Card>
        <Timeline steps={reviewSteps(app)} />
      </Card>
      {app.feedback && (
        <Callout tone="warning" title="Latest feedback sent">
          {app.feedback}
        </Callout>
      )}

      <View style={{ marginTop: 12, gap: 12 }}>
        {app.status === "approved" ? (
          <Card style={{ backgroundColor: colors.green50, borderColor: colors.green100 }}>
            <Row>
              <CircleCheck size={22} color={colors.green700} />
              <Txt variant="label" color={colors.green700} style={{ flex: 1 }}>
                Approved by {app.reviewer_name} and published to the public map.
              </Txt>
            </Row>
          </Card>
        ) : app.status === "rejected" ? (
          <Card style={{ backgroundColor: colors.red50, borderColor: colors.red100 }}>
            <Row>
              <CircleX size={22} color={colors.red700} />
              <Txt variant="label" color={colors.red700} style={{ flex: 1 }}>
                Rejected by {app.reviewer_name} on {formatDateTime(app.decided_at)}.
              </Txt>
            </Row>
          </Card>
        ) : app.status === "changes_requested" ? (
          <Callout title="Waiting for the applicant">The applicant has been asked to update and resubmit.</Callout>
        ) : (
          pending && (
            <>
              {app.status === "submitted" && <Button title="Start review & notify applicant" variant="secondary" loading={startReview.isPending} onPress={() => startReview.mutate()} />}
              <Button title="Approve application" variant="success" icon={<Check size={18} color="white" />} onPress={() => setDecision("approve")} />
              <Row>
                <Button title="Request changes" variant="secondary" small style={{ flex: 1 }} onPress={() => setDecision("request_changes")} />
                <Button title="Request documents" variant="secondary" small style={{ flex: 1 }} onPress={() => setDecision("request_documents")} />
              </Row>
              <Button title="Reject" variant="danger" onPress={() => setDecision("reject")} />
            </>
          )
        )}
      </View>

      <Modal visible={!!decision} transparent animationType="slide" onRequestClose={() => setDecision(null)}>
        <Pressable style={styles.backdrop} onPress={() => setDecision(null)} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap}>
          {copy && decision && (
            <View style={styles.sheet}>
              <View style={[styles.modalIcon, { backgroundColor: `${copy.tone}22` }]}>
                <copy.icon size={24} color={copy.tone} />
              </View>
              <Txt variant="h2" style={{ textAlign: "center" }}>
                {copy.title}
              </Txt>
              <Txt variant="muted" style={{ textAlign: "center", marginBottom: 6 }}>
                {copy.body}
              </Txt>
              {decision !== "approve" && <Field label="Feedback / reason" value={feedback} onChangeText={setFeedback} multiline placeholder="Enter a clear reason for the applicant…" />}
              <FormMessage message={decideError?.message} />
              <Row>
                <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setDecision(null)} />
                <Button title={copy.confirm} variant={copy.variant} style={{ flex: 1 }} loading={decide.isPending} onPress={() => decide.mutate(decision)} />
              </Row>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.blue100, alignItems: "center", justifyContent: "center" },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(9,12,17,0.55)" },
  sheetWrap: { flex: 1, justifyContent: "flex-end", padding: 12 },
  sheet: { backgroundColor: "white", borderRadius: 12, padding: 22, gap: 12 },
  modalIcon: { width: 54, height: 54, borderRadius: 12, alignItems: "center", justifyContent: "center", alignSelf: "center" },
});
