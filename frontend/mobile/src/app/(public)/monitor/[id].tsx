import { useMutation } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { Cctv, Copy, PenLine, Plug, Unplug, Video } from "lucide-react-native";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { LiveFeed } from "@/components/live-feed";
import { Badge, Button, Callout, Card, Chips, ErrorView, Field, FormMessage, Header, KV, Loading, Row, Screen, Txt } from "@/components/ui";
import { api, formErrors } from "@/lib/api";
import { formatDateTime, timeAgo, vehicleTypesLabel } from "@/lib/format";
import { invalidate, useApi } from "@/lib/queries";
import { colors, usePalette, type Tone } from "@/lib/theme";
import type { CameraConnection, OwnerParking } from "@/lib/types";

const CONNECTION_TONE: Record<CameraConnection, Tone> = {
  connected: "success",
  waiting: "info",
  disconnected: "danger",
  maintenance: "warning",
};

// Camera connection status has no push event; poll while the screen is open.
const POLL_MS = 10_000;

function Figure({ label, value, note }: { label: string; value: number; note: string }) {
  const p = usePalette();
  return (
    <View style={[styles.figure, { borderColor: p.border }]}>
      <Txt variant="small">{label}</Txt>
      <Txt variant="h1" style={{ fontSize: 28, lineHeight: 32, fontVariant: ["tabular-nums"] }}>
        {value}
      </Txt>
      <Txt variant="small" style={{ fontSize: 11 }} numberOfLines={1}>
        {note}
      </Txt>
    </View>
  );
}

function CameraForm({ parking, onDone }: { parking: OwnerParking; onDone?: () => void }) {
  const [name, setName] = useState(parking.camera?.name ?? `${parking.name} entrance`);
  const [source, setSource] = useState(parking.camera?.source_url ?? "");
  const save = useMutation({
    mutationFn: () => api<OwnerParking>(`/my-parkings/${parking.id}/camera`, { method: "PUT", json: { name, source_url: source } }),
    onSuccess: () => {
      void invalidate("/my-parkings");
      onDone?.();
    },
  });
  const error = save.error ? formErrors(save.error) : null;
  return (
    <View style={{ gap: 14 }}>
      <Field label="Camera name" value={name} onChangeText={setName} icon={<Cctv size={18} color={colors.slate500} />} error={error?.fields.name} />
      <Field
        label="CCTV stream address"
        value={source}
        onChangeText={setSource}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="rtsp://192.168.1.20:554/stream1"
        hint="The RTSP or HTTP address of your camera or NVR. The AI detector reads the video from here."
        icon={<Video size={18} color={colors.slate500} />}
        error={error?.fields.source_url}
      />
      <FormMessage message={error?.message} />
      <Button title={parking.camera ? "Save camera" : "Connect camera"} icon={<Plug size={18} color="white" />} loading={save.isPending} onPress={() => save.mutate()} />
    </View>
  );
}

function CameraSection({ parking }: { parking: OwnerParking }) {
  const [editing, setEditing] = useState(false);
  const camera = parking.camera;
  const disconnect = useMutation({
    mutationFn: () => api(`/my-parkings/${parking.id}/camera`, { method: "DELETE" }),
    onSuccess: () => void invalidate("/my-parkings"),
    onError: (e) => Alert.alert("Could not disconnect the camera", formErrors(e).message ?? undefined),
  });

  if (!camera) {
    return (
      <Card style={{ gap: 14 }}>
        <Txt variant="h3">Connect a CCTV camera</Txt>
        <Txt variant="muted">
          The same AI vehicle detection used by the traffic police counts the vehicles parked here and keeps your free spaces up to date. Each vehicle is tracked
          while it is in view, so it is only counted once.
        </Txt>
        <CameraForm parking={parking} />
      </Card>
    );
  }

  const connected = camera.connection === "connected";
  const command = `vehicle_detection\\.venv\\Scripts\\python camera-bridge\\bridge.py --camera-code ${camera.code}`;
  return (
    <Card style={{ gap: 14 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt variant="h3" numberOfLines={1} style={{ flex: 1 }}>
          {camera.name}
        </Txt>
        <Badge tone={CONNECTION_TONE[camera.connection]} live={connected}>
          {camera.connection === "connected" ? "Connected" : camera.connection === "waiting" ? "Waiting" : camera.connection === "maintenance" ? "Maintenance" : "Disconnected"}
        </Badge>
      </Row>
      <Txt variant="small">{camera.connection_label}</Txt>
      {connected && <LiveFeed streamUrl={camera.stream_url} aiEnabled label={camera.code} />}
      {camera.connection === "disconnected" && (
        <Callout tone="danger" title="Camera disconnected" icon={<Unplug size={16} color={colors.red500} />}>
          {`The AI detector stopped reporting ${camera.last_seen_at ? timeAgo(camera.last_seen_at) : ""}. Free spaces stay at the last count until it reconnects; correct the count below if it changes meanwhile.`}
        </Callout>
      )}
      {camera.connection === "waiting" && (
        <Callout tone="info" title="Start the AI detector">
          <View style={{ gap: 8 }}>
            <Txt variant="small">Run this on the computer that can reach the camera. It reads the stream address you saved and starts counting.</Txt>
            <Txt variant="small" style={styles.code}>
              {command}
            </Txt>
            <Button title="Copy command" variant="secondary" icon={<Copy size={16} color={colors.slate700} />} onPress={() => void Clipboard.setStringAsync(command)} />
          </View>
        </Callout>
      )}
      <View>
        <KV label="Camera code" value={camera.code} />
        <KV label="Stream" value={camera.source_url} />
        <KV label="Vehicles detected now" value={camera.detected_vehicles ?? "—"} />
        <KV label="Last report" value={camera.last_seen_at ? formatDateTime(camera.last_seen_at) : "Never"} />
      </View>
      {editing ? (
        <CameraForm parking={parking} onDone={() => setEditing(false)} />
      ) : (
        <Button title="Change camera" variant="secondary" onPress={() => setEditing(true)} />
      )}
      <Button
        title="Disconnect camera"
        variant="ghost"
        icon={<Unplug size={16} color={colors.red500} />}
        loading={disconnect.isPending}
        onPress={() =>
          Alert.alert("Disconnect camera?", "Free spaces will no longer update automatically.", [
            { text: "Cancel", style: "cancel" },
            { text: "Disconnect", style: "destructive", onPress: () => disconnect.mutate() },
          ])
        }
      />
    </Card>
  );
}

function CorrectionCard({ parking }: { parking: OwnerParking }) {
  const [value, setValue] = useState(String(parking.occupied_spaces));
  const save = useMutation({
    mutationFn: () =>
      api<OwnerParking>(`/my-parkings/${parking.id}/occupancy`, { method: "PUT", json: { occupied_spaces: value === "" ? null : Number(value) } }),
    onSuccess: () => {
      void invalidate("/my-parkings", "/parkings");
    },
  });
  const error = save.error ? formErrors(save.error) : null;
  return (
    <Card style={{ gap: 14 }}>
      <Txt variant="h3">Correct the count</Txt>
      <Field
        label="Vehicles parked right now"
        value={value}
        onChangeText={setValue}
        keyboardType="number-pad"
        hint={`Between 0 and ${parking.capacity}. Available spaces are worked out from this.`}
        error={error?.fields.occupied_spaces}
      />
      <FormMessage message={error?.message ?? (save.isSuccess ? "Occupancy updated. Public listings show the new figure now." : null)} ok={save.isSuccess && !error} />
      <Button title="Update occupancy" loading={save.isPending} onPress={() => save.mutate()} />
    </Card>
  );
}

export default function MonitorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const owned = useApi<OwnerParking[]>("/my-parkings", undefined, { refetchInterval: POLL_MS });
  const p = usePalette();

  if (owned.isPending) return <Loading />;
  if (owned.isError) return <Screen><ErrorView error={owned.error} onRetry={() => owned.refetch()} /></Screen>;
  const parking = owned.data.find((item) => item.id === id);
  if (!parking) return <Screen><ErrorView error={new Error("This parking location is not yours or no longer exists.")} /></Screen>;

  const source =
    parking.occupancy_source === "camera" ? "Counted by the AI camera" : parking.occupancy_source === "manual" ? "Set by hand" : "Not updated yet";
  const share = parking.capacity > 0 ? Math.min(100, Math.round((parking.occupied_spaces / parking.capacity) * 100)) : 100;

  return (
    <Screen refreshing={owned.isRefetching} onRefresh={() => owned.refetch()}>
      <Header title="Occupancy monitoring" subtitle={parking.name} back />
      {owned.data.length > 1 && (
        <>
          <Txt variant="label" style={{ marginBottom: 8 }}>
            Select parking area
          </Txt>
          <Chips<string> value={parking.id} onChange={(next) => router.setParams({ id: next })} options={owned.data.map((item) => ({ value: item.id, label: item.name }))} />
        </>
      )}
      <Card style={{ gap: 12 }}>
        <Txt variant="small">
          {source}
          {parking.occupancy_updated_at ? ` · ${timeAgo(parking.occupancy_updated_at)}` : ""}
        </Txt>
        <Row gap={8}>
          <Figure label="Capacity" value={parking.capacity} note={vehicleTypesLabel(parking.vehicle_types)} />
          <Figure label="Occupied" value={parking.occupied_spaces} note="parked" />
          <Figure label="Available" value={parking.available_spaces} note="capacity − occupied" />
        </Row>
        <View style={[styles.bar, { backgroundColor: p.surfaceMuted }]} accessibilityLabel={`${parking.occupied_spaces} of ${parking.capacity} spaces taken`}>
          <View style={{ width: `${share}%`, height: "100%", borderRadius: 3, backgroundColor: share >= 100 ? colors.red500 : share >= 50 ? colors.amber500 : colors.green500 }} />
        </View>
      </Card>
      {parking.manual_hold && (
        <View style={{ marginTop: 12 }}>
          <Callout tone="info" title="Your correction is in use" icon={<PenLine size={16} color={colors.blue700} />}>
            The camera resumes counting automatically as soon as the vehicles it sees change.
          </Callout>
        </View>
      )}
      <View style={{ marginTop: 12, gap: 12 }}>
        <CameraSection parking={parking} />
        <CorrectionCard parking={parking} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  figure: { flex: 1, gap: 4, padding: 10, borderWidth: 1, borderRadius: 10 },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
  code: { fontFamily: "monospace", fontSize: 11, padding: 8, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.06)" },
});
