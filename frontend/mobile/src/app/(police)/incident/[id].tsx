import { useMutation } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { CircleCheck, MessageSquare } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { MapView } from "@/components/map-view";
import { Badge, Button, Card, CctvPreview, ErrorView, Field, FormMessage, Header, KV, Loading, Row, Screen, SectionTitle, Txt } from "@/components/ui";
import { api, formErrors } from "@/lib/api";
import { formatClock, formatDateTime, percent, timeAgo } from "@/lib/format";
import { invalidate, queryClient, useApi } from "@/lib/queries";
import type { IncidentDetail } from "@/lib/types";

export default function Incident() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useApi<IncidentDetail>(`/incidents/${id}`);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const update = (incident: IncidentDetail) => queryClient.setQueryData([`/incidents/${id}`, {}], incident);

  const addNote = useMutation({
    mutationFn: () => api<IncidentDetail>(`/incidents/${id}/notes`, { method: "POST", json: { body: note } }),
    onSuccess: (incident) => {
      update(incident);
      setNote("");
    },
  });
  const resolve = useMutation({
    mutationFn: () => api<IncidentDetail>(`/incidents/${id}/resolve`, { method: "POST", json: { resolution: resolution || "Vehicle moved and road cleared." } }),
    onSuccess: (incident) => {
      update(incident);
      void invalidate("/alerts", "/incidents", "/police");
    },
  });

  if (query.isPending) return <Loading />;
  if (query.isError) return <Screen><ErrorView error={query.error} onRetry={() => query.refetch()} /></Screen>;
  const incident = query.data;
  const a = incident.alert;
  const resolved = incident.status === "resolved";
  const noteError = addNote.error ? formErrors(addNote.error) : null;
  const resolveError = resolve.error ? formErrors(resolve.error) : null;

  return (
    <Screen refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <Header title={`Incident ${incident.code}`} subtitle={`Created ${formatDateTime(incident.created_at)}`} back right={<Badge tone={resolved ? "success" : "warning"}>{resolved ? "Resolved" : "In progress"}</Badge>} />
      <CctvPreview label={`${a.camera_code} · EVIDENCE ${formatClock(a.detected_at)}`} detection={a.plate_number ?? "Vehicle"} height={210} />

      <Card style={{ marginTop: 12 }}>
        <Txt variant="h3" style={{ marginBottom: 6 }}>
          Incident details
        </Txt>
        <KV label="Violation" value={a.violation_label} />
        <KV label="Location" value={a.road} />
        <KV label="Detected" value={formatDateTime(a.detected_at)} />
        <KV label="Vehicle" value={`${a.vehicle_color ?? ""} ${a.vehicle_type}${a.plate_number ? ` · ${a.plate_number}` : ""}`.trim()} />
        <KV label="CCTV source" value={a.camera_code} />
        <KV label="Confidence" value={percent(a.confidence)} />
        <KV label="Handling officer" value={incident.officer_name} />
      </Card>

      <MapView height={180} style={{ marginTop: 12 }} center={{ latitude: a.latitude, longitude: a.longitude }} zoom={16} fit={false} points={[{ id: a.id, latitude: a.latitude, longitude: a.longitude, tone: "incident", kind: "incident", title: a.violation_label, subtitle: a.road }]} />

      <SectionTitle title={`Officer notes (${incident.notes.length})`} />
      <Card style={{ gap: 12 }}>
        {incident.notes.length ? (
          incident.notes.map((n) => (
            <View key={n.id} style={{ gap: 3 }}>
              <Txt variant="body">{n.body}</Txt>
              <Txt variant="small">
                {n.author_name} · {timeAgo(n.created_at)}
              </Txt>
            </View>
          ))
        ) : (
          <Row>
            <MessageSquare size={16} color="#0859ac" />
            <Txt variant="muted">No notes yet.</Txt>
          </Row>
        )}
        {!resolved && (
          <>
            <Field label="Add a note" value={note} onChangeText={setNote} placeholder="e.g. Driver located, vehicle being moved." multiline error={noteError?.fields.body} />
            <Button title="Add note" variant="secondary" loading={addNote.isPending} disabled={note.trim().length < 2} onPress={() => addNote.mutate()} />
          </>
        )}
      </Card>

      {resolved ? (
        <Card style={{ marginTop: 12, backgroundColor: "rgba(41,172,104,0.14)", borderColor: "rgba(41,172,104,0.3)" }}>
          <Row>
            <CircleCheck size={22} color="#006436" />
            <View style={{ flex: 1 }}>
              <Txt variant="label" color="#006436">
                Incident resolved
              </Txt>
              <Txt variant="small">
                {incident.resolution} Closed at {formatClock(incident.resolved_at)}.
              </Txt>
            </View>
          </Row>
        </Card>
      ) : (
        <Card style={{ marginTop: 12, gap: 12 }}>
          <Txt variant="h3">Resolve incident</Txt>
          <Field label="Outcome" value={resolution} onChangeText={setResolution} placeholder="Vehicle moved and road cleared." />
          <FormMessage message={resolveError?.message} />
          <Button title="Mark resolved" variant="success" icon={<CircleCheck size={18} color="white" />} loading={resolve.isPending} onPress={() => resolve.mutate()} />
        </Card>
      )}
    </Screen>
  );
}
