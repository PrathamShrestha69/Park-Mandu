import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronRight, MapPin } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SEVERITY, timeAgo, titleCase } from "@/lib/format";
import { invalidate } from "@/lib/queries";
import { colors, fonts } from "@/lib/theme";
import type { Alert, IncidentSummary, User } from "@/lib/types";

import { Badge, Card, Row, Txt } from "./ui";

const STATUS_TONE = { active: "danger", assigned: "warning", resolved: "success", dismissed: "neutral" } as const;

export function AlertRow({ alert }: { alert: Alert }) {
  return (
    <Card onPress={() => router.push(`/alert/${alert.id}` as never)} accessibilityLabel={`${SEVERITY[alert.severity].label} priority: ${alert.violation_label} on ${alert.road}`}>
      <Row>
        <View style={{ flex: 1, gap: 4 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Row gap={6}>
              <Badge tone={SEVERITY[alert.severity].tone}>{SEVERITY[alert.severity].label}</Badge>
              <Badge tone={STATUS_TONE[alert.status]}>{titleCase(alert.status)}</Badge>
            </Row>
            <Txt variant="small">{timeAgo(alert.detected_at)}</Txt>
          </Row>
          <Txt variant="h3" style={{ marginTop: 2 }}>
            {alert.violation_label}
          </Txt>
          <Row gap={4}>
            <MapPin size={13} color={colors.slate400} />
            <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>
              {alert.road} · {alert.camera_code}
              {alert.plate_number ? ` · ${alert.plate_number}` : ""}
            </Txt>
          </Row>
        </View>
        <ChevronRight size={20} color={colors.slate400} />
      </Row>
    </Card>
  );
}

export function IncidentRow({ incident }: { incident: IncidentSummary }) {
  const resolved = incident.status === "resolved";
  return (
    <Card onPress={() => router.push(`/incident/${incident.id}` as never)}>
      <Row>
        <View style={{ flex: 1, gap: 4 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Badge tone={resolved ? "success" : "warning"}>{resolved ? "Resolved" : "In progress"}</Badge>
            <Txt variant="small">{incident.code}</Txt>
          </Row>
          <Txt variant="h3">{incident.violation_label}</Txt>
          <Txt variant="small">
            {incident.road} · {incident.camera_code}
            {incident.plate_number ? ` · ${incident.plate_number}` : ""}
          </Txt>
          <Txt variant="small">
            {incident.officer_name} · opened {timeAgo(incident.created_at)}
          </Txt>
        </View>
        <ChevronRight size={20} color={colors.slate400} />
      </Row>
    </Card>
  );
}

export function DutyToggle() {
  const { user, refreshUser } = useAuth();
  const toggle = useMutation({
    mutationFn: () => api<User>("/police/duty", { method: "PATCH", json: { on_duty: !user?.on_duty } }),
    onSuccess: async () => {
      await refreshUser();
      void invalidate("/police");
    },
  });
  const on = !!user?.on_duty;
  return (
    <Pressable
      onPress={() => toggle.mutate()}
      disabled={toggle.isPending}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel="Duty status"
      style={[styles.duty, { backgroundColor: on ? "rgba(41,172,104,0.18)" : "#f2f3f7" }]}
    >
      <View style={[styles.dot, { backgroundColor: on ? "#006436" : colors.slate400 }]} />
      <Txt variant="label" color={on ? "#006436" : colors.slate600} style={{ fontFamily: fonts.bold, fontSize: 12 }}>
        {on ? "On duty" : "Off duty"}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  duty: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
