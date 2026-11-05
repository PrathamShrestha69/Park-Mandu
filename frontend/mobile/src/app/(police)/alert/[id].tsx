import { useMutation } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { Cctv, CircleCheck, Navigation, ShieldCheck, TriangleAlert, X } from "lucide-react-native";
import { useState } from "react";
import { Alert as RNAlert, Linking, Platform, StyleSheet, View } from "react-native";

import { MapView } from "@/components/map-view";
import { Badge, Button, Card, CctvPreview, ErrorView, Field, FormMessage, Loading, Row, Screen, Txt } from "@/components/ui";
import { api, authHeaders, formErrors } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { SEVERITY, formatClock, formatDateTime, percent, timeAgo } from "@/lib/format";
import { invalidate, useApi } from "@/lib/queries";
import { colors } from "@/lib/theme";
import type { Alert, IncidentDetail } from "@/lib/types";

function Pair({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={{ width: "48%", gap: 3 }}>
      <Txt variant="small">{label}</Txt>
      {typeof value === "string" ? <Txt variant="label">{value}</Txt> : value}
    </View>
  );
}

export default function AlertDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useApi<Alert>(`/alerts/${id}`);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");

  const handle = useMutation({
    mutationFn: () => api<IncidentDetail>(`/alerts/${id}/handle`, { method: "POST" }),
    onSuccess: (incident) => {
      void invalidate("/alerts", "/incidents", "/police");
      router.replace(`/incident/${incident.id}` as never);
    },
    onError: (e) => {
      RNAlert.alert("Could not take this alert", formErrors(e).message ?? undefined);
      void query.refetch();
    },
  });
  const dismiss = useMutation({
    mutationFn: () => api(`/alerts/${id}/dismiss`, { method: "POST", json: { reason } }),
    onSuccess: () => {
      void invalidate("/alerts", "/police");
      router.back();
    },
  });

  if (query.isPending) return <Loading />;
  if (query.isError) return <Screen><ErrorView error={query.error} onRetry={() => query.refetch()} /></Screen>;
  const a = query.data;
  const open = a.status === "active";
  const navigate = Platform.select({ ios: `http://maps.apple.com/?daddr=${a.latitude},${a.longitude}`, default: `https://www.google.com/maps/dir/?api=1&destination=${a.latitude},${a.longitude}` });
  const dismissError = dismiss.error ? formErrors(dismiss.error) : null;

  return (
    <Screen>
      <Row style={[styles.urgent, !open && { backgroundColor: colors.navy800 }]}>
        <Button small variant="ghost" title="Back" onPress={() => router.back()} style={{ backgroundColor: "rgba(255,255,255,0.14)" }} />
        <View style={{ flex: 1 }}>
          <Txt variant="eyebrow" color="rgba(255,255,255,0.82)">
            {open ? "Real-time alert" : `Alert ${a.status}`}
          </Txt>
          <Txt variant="label" color="white">
            {a.code} · detected {timeAgo(a.detected_at).toLowerCase()}
          </Txt>
        </View>
      </Row>

      <View style={{ alignItems: "center", gap: 6, marginVertical: 16 }}>
        <View style={styles.dangerIcon}>
          <TriangleAlert size={30} color="#b91f25" />
        </View>
        <Txt variant="h1">Illegal Parking Detected</Txt>
        <Txt variant="muted">
          {a.violation_label} · {a.road}
        </Txt>
      </View>

      {a.has_snapshot ? (
        <View style={styles.snapshot}>
          <Image
            source={{ uri: `${API_URL}/files/alerts/${a.id}/snapshot`, headers: authHeaders() }}
            style={{ width: "100%", height: 210 }}
            contentFit="contain"
            accessibilityLabel={`Vehicle captured by camera ${a.camera_code}`}
          />
          <Txt variant="small" color="rgba(255,255,255,0.8)" style={{ padding: 8 }}>
            {a.camera_code} · {formatClock(a.detected_at)} · AI capture {percent(a.confidence)}
          </Txt>
        </View>
      ) : (
        <CctvPreview label={`${a.camera_code} · ${formatClock(a.detected_at)}`} detection={`${a.plate_number ?? "Plate unreadable"} · ${percent(a.confidence)}`} height={210} />
      )}

      <Card style={{ marginTop: 12 }}>
        <View style={styles.pairs}>
          <Pair label="Location" value={a.road} />
          <Pair label="CCTV camera" value={a.camera_code} />
          <Pair label="Detection time" value={formatDateTime(a.detected_at)} />
          <Pair label="Severity" value={<Badge tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Badge>} />
          <Pair label="Vehicle" value={`${a.vehicle_color ?? ""} ${a.vehicle_type}`.trim()} />
          <Pair label="License plate" value={a.plate_number ?? "Not readable"} />
          <Pair label="Violation" value={a.violation_label} />
          <Pair label="Direction" value={a.direction ?? "—"} />
        </View>
        <Row style={{ justifyContent: "space-between", marginTop: 12 }}>
          <Txt variant="small">Detection confidence</Txt>
          <Txt variant="label" color={a.confidence >= 0.85 ? "#b91f25" : "#8d4f0c"}>
            {percent(a.confidence)} {a.confidence >= 0.85 ? "high" : "medium"}
          </Txt>
        </Row>
        <View style={styles.meter} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(a.confidence * 100) }}>
          <View style={[styles.meterFill, { width: percent(a.confidence) as `${number}%` }]} />
        </View>
      </Card>

      <MapView height={190} style={{ marginTop: 12 }} center={{ latitude: a.latitude, longitude: a.longitude }} zoom={16} fit={false} points={[{ id: a.id, latitude: a.latitude, longitude: a.longitude, tone: "incident", kind: "incident", title: a.violation_label, subtitle: a.road }]} />

      <Row style={{ marginTop: 12 }}>
        <Button title="View camera" variant="secondary" style={{ flex: 1 }} icon={<Cctv size={18} color="white" />} onPress={() => router.push(`/camera/${a.camera_id}` as never)} />
        <Button title="Navigate" variant="secondary" style={{ flex: 1 }} icon={<Navigation size={18} color="white" />} onPress={() => navigate && Linking.openURL(navigate)} />
      </Row>

      <View style={{ gap: 12, marginTop: 10 }}>
        {open ? (
          dismissing ? (
            <Card style={{ gap: 12 }}>
              <Field label="Reason for dismissing" value={reason} onChangeText={setReason} placeholder="e.g. Authorised ambulance loading" error={dismissError?.fields.reason} multiline />
              <FormMessage message={dismissError?.message} />
              <Row>
                <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setDismissing(false)} />
                <Button title="Dismiss alert" variant="danger" style={{ flex: 1 }} loading={dismiss.isPending} onPress={() => dismiss.mutate()} />
              </Row>
            </Card>
          ) : (
            <>
              <Button title="Assign to me / handle incident" variant="danger" icon={<ShieldCheck size={18} color="white" />} loading={handle.isPending} onPress={() => handle.mutate()} />
              <Button title="Dismiss alert" variant="ghost" icon={<X size={18} color={colors.slate300} />} onPress={() => setDismissing(true)} />
            </>
          )
        ) : a.incident_id ? (
          <Button title={`Open incident${a.assigned_officer_name ? ` · ${a.assigned_officer_name}` : ""}`} onPress={() => router.push(`/incident/${a.incident_id}` as never)} />
        ) : (
          <Card style={{ backgroundColor: "rgba(41,172,104,0.14)", borderColor: "rgba(41,172,104,0.3)" }}>
            <Row>
              <CircleCheck size={22} color="#006436" />
              <View style={{ flex: 1 }}>
                <Txt variant="label" color="#006436">
                  Alert {a.status}
                </Txt>
                <Txt variant="small">{a.dismiss_reason ?? `Closed ${formatDateTime(a.closed_at)}`}</Txt>
              </View>
            </Row>
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  snapshot: { borderRadius: 12, overflow: "hidden", backgroundColor: "#1a2230" },
  urgent: { backgroundColor: colors.red700, borderRadius: 12, padding: 12 },
  dangerIcon: { width: 60, height: 60, borderRadius: 12, backgroundColor: "rgba(244,89,91,0.16)", alignItems: "center", justifyContent: "center" },
  pairs: { flexDirection: "row", flexWrap: "wrap", rowGap: 16, justifyContent: "space-between" },
  meter: { height: 8, borderRadius: 6, backgroundColor: "#e4e6ea", overflow: "hidden", marginTop: 8 },
  meterFill: { height: "100%", backgroundColor: colors.red500, borderRadius: 6 },
});
