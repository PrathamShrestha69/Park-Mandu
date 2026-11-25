import { router, useLocalSearchParams } from "expo-router";
import { CircleCheck, MessageSquare, PenLine } from "lucide-react-native";

import { DeleteDraftButton, DocumentList, OwnerSummary, PropertySummary, StatusBadge, Timeline, WIZARD_STEPS, reviewSteps } from "@/components/parking";
import { Button, Callout, Card, ErrorView, Header, Loading, Screen, SectionTitle, Txt } from "@/components/ui";
import { useApi } from "@/lib/queries";
import { colors } from "@/lib/theme";
import type { ApplicationDetail } from "@/lib/types";

export default function ApplicationStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useApi<ApplicationDetail>(`/applications/${id}`);

  if (query.isPending) return <Loading />;
  if (query.isError) return <Screen><ErrorView error={query.error} onRetry={() => query.refetch()} /></Screen>;
  const app = query.data;
  const editable = app.status === "draft" || app.status === "changes_requested";
  const resume = app.status === "changes_requested" ? "review" : WIZARD_STEPS[Math.min(app.completed_step, 4)];

  return (
    <Screen refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <Header title="Application status" subtitle={app.reference ?? "Draft — not submitted yet"} back />
      <Card style={{ gap: 6 }}>
        <StatusBadge status={app.status} />
        <Txt variant="h2">{app.property_name ?? "Untitled parking location"}</Txt>
        <Txt variant="muted">{app.address ?? "Location not set"}</Txt>
      </Card>

      {app.feedback && (app.status === "changes_requested" || app.status === "rejected") && (
        <Callout tone="danger" title={app.status === "rejected" ? "Reason from the review team" : "Feedback from the review team"} icon={<MessageSquare size={18} color={colors.red700} />}>
          {app.feedback}
        </Callout>
      )}
      {app.status === "approved" && app.parking_location_id && (
        <Callout tone="success" title="Your parking is live" icon={<CircleCheck size={18} color={colors.green700} />}>
          It is now visible to the public on the Park Mandu map.
        </Callout>
      )}

      {editable && (
        <Button
          title={app.status === "draft" ? "Continue application" : "Edit and resubmit"}
          icon={<PenLine size={18} color="white" />}
          style={{ marginTop: 12 }}
          onPress={() => router.push(`/application/${app.id}/edit/${resume}` as never)}
        />
      )}
      {app.status === "draft" && <DeleteDraftButton applicationId={app.id} onDeleted={() => router.replace("/my-parking" as never)} />}

      {app.status !== "draft" && (
        <>
          <SectionTitle title="Review progress" />
          <Card>
            <Timeline steps={reviewSteps(app)} />
          </Card>
        </>
      )}

      <SectionTitle title="Location & property" />
      <Card>
        <PropertySummary app={app} />
      </Card>
      <SectionTitle title="Owner information" />
      <Card>
        <OwnerSummary app={app} />
      </Card>
      <SectionTitle title={`Documents (${app.documents.length})`} />
      <DocumentList app={app} />
    </Screen>
  );
}
