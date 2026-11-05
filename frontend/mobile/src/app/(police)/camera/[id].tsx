import { router, useLocalSearchParams } from "expo-router";
import { Clock, Gauge, MapPin, TriangleAlert } from "lucide-react-native";
import { View } from "react-native";

import { LiveFeed } from "@/components/live-feed";
import { MapView } from "@/components/map-view";
import { AlertRow } from "@/components/police";
import { Badge, Button, Card, Empty, ErrorView, Header, Loading, Row, Screen, SectionTitle, Txt } from "@/components/ui";
import { CAMERA_STATUS, TRAFFIC, formatClock, formatDateTime, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/queries";
import type { Alert, Camera, Page } from "@/lib/types";

const ICON = "#0859ac";

export default function CameraDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const camera = useApi<Camera>(`/cameras/${id}`, undefined, { refetchInterval: 30_000 });
  const alerts = useApi<Page<Alert>>("/alerts", { camera_id: id, status: "open", size: 5, sort: "severity" }, { refetchInterval: 15_000 });

  if (camera.isPending) return <Loading />;
  if (camera.isError) return <Screen><ErrorView error={camera.error} onRetry={() => camera.refetch()} /></Screen>;
  const c = camera.data;
  const live = c.status === "live";
  const latest = alerts.data?.items[0];

  return (
    <Screen refreshing={camera.isRefetching} onRefresh={() => Promise.all([camera.refetch(), alerts.refetch()])}>
      <Header title={c.code} subtitle={live ? "Live camera feed" : CAMERA_STATUS[c.status].label} back right={<Badge tone={CAMERA_STATUS[c.status].tone} live={live}>{CAMERA_STATUS[c.status].label}</Badge>} />
      <LiveFeed streamUrl={c.stream_url} label={`${c.code} · ${formatClock(c.last_heartbeat_at)}`} offline={!live} detection={latest ? `${latest.vehicle_type} · ${Math.round(latest.confidence * 100)}%` : undefined} height={220} />
      <Txt variant="small" style={{ marginTop: 6 }}>
        {c.stream_url ? "Live AI view · red boxes are vehicles flagged as parked" : `Simulated camera · no AI detector connected (${c.zone})`}
      </Txt>

      <Card style={{ marginTop: 12, gap: 16 }}>
        <Txt variant="h3">{c.name}</Txt>
        <Row style={{ alignItems: "flex-start" }}>
          <MapPin size={18} color={ICON} />
          <View style={{ flex: 1 }}>
            <Txt variant="label">{c.road}</Txt>
            <Txt variant="small">
              {c.area} · {c.zone}
            </Txt>
          </View>
        </Row>
        <Row style={{ alignItems: "flex-start" }}>
          <Clock size={18} color={ICON} />
          <View style={{ flex: 1 }}>
            <Txt variant="label">Last updated</Txt>
            <Txt variant="small">
              {formatDateTime(c.last_heartbeat_at)} ({timeAgo(c.last_heartbeat_at)})
            </Txt>
          </View>
        </Row>
        <Row style={{ alignItems: "flex-start" }}>
          <Gauge size={18} color={ICON} />
          <View style={{ flex: 1 }}>
            <Txt variant="label">Traffic: {TRAFFIC[c.traffic_level].label}</Txt>
            <Txt variant="small">Average speed {c.avg_speed_kmh} km/h</Txt>
          </View>
        </Row>
      </Card>

      <SectionTitle title={`Active violations (${c.active_violations})`} />
      <View style={{ gap: 12 }}>
        {alerts.data?.items.length ? (
          alerts.data.items.map((a) => <AlertRow key={a.id} alert={a} />)
        ) : (
          <Empty icon={<TriangleAlert size={24} color="#0859ac" />} title="No open alerts" body="New detections from this camera appear here." />
        )}
      </View>
      <Button title="View all alerts from this camera" variant="danger" icon={<TriangleAlert size={18} color="white" />} style={{ marginTop: 12 }} onPress={() => router.push("/alerts")} />

      <SectionTitle title="Location" />
      <MapView height={200} center={{ latitude: c.latitude, longitude: c.longitude }} zoom={16} fit={false} points={[{ id: c.id, latitude: c.latitude, longitude: c.longitude, tone: "camera", kind: "camera", title: c.code, subtitle: c.road, offline: !live }]} />
    </Screen>
  );
}
