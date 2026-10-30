import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MapView } from "@/components/map-view";
import { Card, Header, Row, Screen, Txt } from "@/components/ui";
import { useApi } from "@/lib/queries";
import { colors, fonts } from "@/lib/theme";
import type { AdminMap } from "@/lib/types";

const LAYERS = [
  { key: "approved", label: "Approved", color: colors.green500 },
  { key: "pending", label: "Pending", color: colors.slate500 },
  { key: "rejected", label: "Rejected", color: colors.red500 },
  { key: "cameras", label: "CCTV", color: colors.navy800 },
  { key: "incidents", label: "Illegal parking", color: colors.red500 },
] as const;

export default function ValleyMap() {
  const [active, setActive] = useState<string[]>(LAYERS.map((l) => l.key));
  const data = useApi<AdminMap>("/admin/map", { layers: active });
  const toggle = (key: string) => setActive((a) => (a.includes(key) ? (a.length > 1 ? a.filter((k) => k !== key) : a) : [...a, key]));

  return (
    <Screen refreshing={data.isRefetching} onRefresh={() => data.refetch()}>
      <Header title="Valley parking map" subtitle="Parking, applications and CCTV at a glance" />
      <View style={styles.chips}>
        {LAYERS.map((l) => {
          const on = active.includes(l.key);
          return (
            <Pressable key={l.key} onPress={() => toggle(l.key)} style={[styles.chip, on && { backgroundColor: colors.violetTint, borderColor: colors.violet }]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
              <View style={[styles.dot, { backgroundColor: l.color }]} />
              <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: on ? "white" : colors.slate700 }}>
                {l.label} {data.data?.counts[l.key] ?? ""}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <MapView
        height={440}
        points={(data.data?.markers ?? []).map((m) => ({ id: m.id, latitude: m.latitude, longitude: m.longitude, tone: m.tone, kind: m.kind, title: m.name, subtitle: m.subtitle, offline: m.kind === "camera" && m.status !== "live" }))}
        onSelect={(p) => {
          if (p.kind === "pending" || p.kind === "rejected") router.push(`/review/${p.id}` as never);
        }}
      />
      <Card style={{ marginTop: 12 }}>
        <Row style={{ justifyContent: "space-around" }}>
          {[
            [data.data?.counts.approved ?? 0, "Parking"],
            [data.data?.counts.cameras ?? 0, "Cameras"],
            [data.data?.counts.incidents ?? 0, "Alerts"],
          ].map(([n, label]) => (
            <View key={label} style={{ alignItems: "center" }}>
              <Txt variant="h2">{n}</Txt>
              <Txt variant="small">{label}</Txt>
            </View>
          ))}
        </Row>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.slate300, backgroundColor: "white", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
});
