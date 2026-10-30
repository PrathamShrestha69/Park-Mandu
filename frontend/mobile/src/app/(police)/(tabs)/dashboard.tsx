import { router } from "expo-router";
import { Cctv, ChevronRight, CircleCheck, Siren, TriangleAlert } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { MapView } from "@/components/map-view";
import { DutyToggle } from "@/components/police";
import { Badge, Card, ErrorView, Loading, Row, Screen, SectionTitle, StatCard, Txt } from "@/components/ui";
import { TRAFFIC, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/queries";
import { colors } from "@/lib/theme";
import type { Alert, Camera, Page, PoliceDashboard } from "@/lib/types";

// Mobile has no EventSource; a short polling interval keeps the dashboard live.
const LIVE = { refetchInterval: 15_000 };

export default function Dashboard() {
  const dashboard = useApi<PoliceDashboard>("/police/dashboard", undefined, LIVE);
  const cameras = useApi<Page<Camera>>("/cameras", { size: 100 });
  const alerts = useApi<Page<Alert>>("/alerts", { status: "open", size: 100 }, LIVE);

  if (dashboard.isPending) return <Loading label="Loading live monitoring…" />;
  if (dashboard.isError) return <Screen><ErrorView error={dashboard.error} onRetry={() => dashboard.refetch()} /></Screen>;
  const d = dashboard.data;
  const latest = d.latest_alert;

  return (
    <Screen refreshing={dashboard.isRefetching} onRefresh={() => Promise.all([dashboard.refetch(), alerts.refetch(), cameras.refetch()])}>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <View>
          <Txt variant="eyebrow" style={{ marginBottom: 4 }}>
            Traffic Monitoring
          </Txt>
          <Txt variant="h1">{d.officer.unit?.split("·")[1]?.trim() ?? "Kathmandu"} District</Txt>
          <Txt variant="small">
            {d.officer.designation} {d.officer.full_name} · {d.officer.badge_number}
          </Txt>
        </View>
        <DutyToggle />
      </Row>

      <View style={styles.stats}>
        <StatCard tone="danger" icon={<TriangleAlert size={20} color="#b91f25" />} label="Live alerts" value={d.alerts.open} note={`${d.alerts.high_priority} high priority`} onPress={() => router.push("/alerts")} />
        <StatCard tone="info" icon={<Cctv size={20} color="#0859ac" />} label="Cameras live" value={d.cameras.live} note={`${d.cameras.offline} offline`} onPress={() => router.push("/cameras")} />
        <StatCard tone="warning" icon={<Siren size={20} color="#8d4f0c" />} label="My open incidents" value={d.open_incidents_mine} onPress={() => router.push("/incidents")} />
        <StatCard tone="success" icon={<CircleCheck size={20} color="#006436" />} label="Resolved today" value={d.alerts.resolved_today} />
      </View>

      {latest && (
        <Card onPress={() => router.push(`/alert/${latest.id}` as never)} style={styles.alertCard}>
          <Row gap={13}>
            <View style={styles.pulse}>
              <TriangleAlert size={22} color="white" />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Row style={{ justifyContent: "space-between" }}>
                <Badge tone="danger">{latest.severity === "high" ? "HIGH PRIORITY" : "NEW ALERT"}</Badge>
                <Txt variant="small">{timeAgo(latest.detected_at)}</Txt>
              </Row>
              <Txt variant="h3">Illegal parking detected</Txt>
              <Txt variant="small" numberOfLines={2}>
                {latest.violation_label} · {latest.road} · {latest.camera_code}
              </Txt>
            </View>
            <ChevronRight size={20} color={colors.slate400} />
          </Row>
        </Card>
      )}

      <SectionTitle title="Live road network" />
      <MapView
        height={300}
        points={[
          ...(cameras.data?.items ?? []).map((c) => ({ id: c.id, latitude: c.latitude, longitude: c.longitude, tone: "camera" as const, kind: "camera" as const, title: `${c.code} · ${c.name}`, subtitle: `${c.active_violations} active violations`, offline: c.status !== "live" })),
          ...(alerts.data?.items ?? []).map((a) => ({ id: a.id, latitude: a.latitude, longitude: a.longitude, tone: "incident" as const, kind: "incident" as const, title: a.violation_label, subtitle: `${a.road} · ${a.camera_code}` })),
        ]}
        onSelect={(p) => router.push((p.kind === "camera" ? `/camera/${p.id}` : `/alert/${p.id}`) as never)}
      />

      <SectionTitle title="Road conditions" />
      <Card style={{ paddingVertical: 4 }}>
        {d.road_conditions.map((r, i) => (
          <Row key={r.camera_code} style={[styles.condition, i < d.road_conditions.length - 1 && styles.conditionDivider]}>
            <View style={[styles.light, { backgroundColor: { clear: colors.green500, moderate: colors.blue500, slow: colors.amber500, congested: colors.red500 }[r.traffic_level] }]} />
            <View style={{ flex: 1 }}>
              <Txt variant="label">{r.road}</Txt>
              <Txt variant="small">
                Average speed {r.avg_speed_kmh} km/h · {r.camera_code}
              </Txt>
            </View>
            <Badge tone={TRAFFIC[r.traffic_level].tone}>{TRAFFIC[r.traffic_level].label}</Badge>
          </Row>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  alertCard: { marginTop: 12, borderColor: "rgba(244,89,91,0.45)", backgroundColor: "rgba(244,89,91,0.12)" },
  pulse: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.red500, alignItems: "center", justifyContent: "center" },
  condition: { paddingVertical: 12 },
  conditionDivider: { borderBottomWidth: 1, borderBottomColor: "#e4e6ea" },
  light: { width: 10, height: 10, borderRadius: 5 },
});
