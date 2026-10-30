import { router } from "expo-router";
import { ArrowRight, Bell, FileCheck2, LocateFixed, Search } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { MapView } from "@/components/map-view";
import { ParkingCard } from "@/components/parking";
import { Button, Card, Dot, Empty, Header, IconButton, Row, Screen, Stack, Txt } from "@/components/ui";
import { useViewer } from "@/lib/auth";
import { greeting } from "@/lib/format";
import { useMyLocation } from "@/lib/location";
import { useApi } from "@/lib/queries";
import { colors, fonts, radius, shadow, space } from "@/lib/theme";
import type { MapMarker, Page, ParkingSummary } from "@/lib/types";

const CITY_CENTRE = { latitude: 27.7048, longitude: 85.3117 };

export default function Home() {
  const viewer = useViewer();
  const { coords, busy, locate } = useMyLocation();
  const origin = coords ?? CITY_CENTRE;
  const [q, setQ] = useState("");

  const unread = useApi<{ unread: number }>("/notifications/unread-count");
  const markers = useApi<MapMarker[]>("/parkings/map");
  const nearby = useApi<Page<ParkingSummary>>("/parkings", {
    lat: origin.latitude,
    lng: origin.longitude,
    radius_m: 10_000,
    available_only: true,
    open_now: true,
    sort: "distance",
    size: 3,
  });
  const locationQuery = coords ? `?lat=${coords.latitude}&lng=${coords.longitude}` : "";

  const refresh = () => Promise.all([markers.refetch(), nearby.refetch(), unread.refetch()]);

  return (
    <Screen refreshing={markers.isRefetching || nearby.isRefetching} onRefresh={refresh}>
      <Header
        eyebrow={greeting()}
        title={viewer.full_name}
        right={
          <IconButton label="Notifications" badge={unread.data?.unread} onPress={() => router.push("/notifications")}>
            <Bell size={20} color={colors.slate950} />
          </IconButton>
        }
      />

      <View>
        <MapView
          height={360}
          me={coords}
          points={(markers.data ?? []).map((m) => ({ id: m.id, latitude: m.latitude, longitude: m.longitude, tone: m.tone, kind: m.kind, title: m.name, subtitle: m.subtitle }))}
          onSelect={(point) => point.kind === "parking" && router.push(`/parking/${point.id}${locationQuery}` as never)}
        />
        <View style={styles.searchOverlay}>
          <Search size={18} color={colors.slate500} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search parking or location"
            placeholderTextColor={colors.slate500}
            selectionColor={colors.blue600}
            returnKeyType="search"
            onSubmitEditing={() => router.push({ pathname: "/explore", params: { q, ...(coords ? { lat: String(coords.latitude), lng: String(coords.longitude) } : {}) } })}
            style={styles.searchInput}
            accessibilityLabel="Search parking or location"
          />
        </View>
        <View style={styles.legend}>
          {[
            [colors.green500, "Available"],
            [colors.blue600, "Government"],
            [colors.slate400, "Pending"],
            [colors.red500, "Unavailable"],
          ].map(([c, label]) => (
            <Row key={label} gap={5}>
              <Dot color={c} />
              <Txt variant="small" style={{ fontSize: 11 }}>
                {label}
              </Txt>
            </Row>
          ))}
        </View>
      </View>

      <Card style={{ marginTop: space.block }}>
        <Row style={{ justifyContent: "space-between", marginBottom: space.toolbar }}>
          <View>
            <Txt variant="h3">Nearest available</Txt>
            <Txt variant="small">{coords ? "From your location" : "From central Kathmandu"}</Txt>
          </View>
          <Button title={busy ? "Locating…" : "Near me"} small variant="secondary" icon={<LocateFixed size={15} color={colors.slate950} />} onPress={() => void locate(true)} />
        </Row>
        <Stack>
          {nearby.data?.items.length ? (
            nearby.data.items.map((p) => <ParkingCard key={p.id} parking={p} query={locationQuery} />)
          ) : nearby.isPending ? (
            <Txt variant="muted">Finding open parking near you…</Txt>
          ) : (
            <Empty icon={<Search size={20} color={colors.slate600} />} title="No open parking nearby" body="Most lots close by 21:00. Try the map to see all locations." />
          )}
        </Stack>
        <Button title="See all parking" variant="secondary" style={{ marginTop: space.toolbar }} onPress={() => router.push({ pathname: "/explore", params: coords ? { lat: String(coords.latitude), lng: String(coords.longitude) } : {} })} />
      </Card>

      <Pressable
        onPress={() => router.push("/my-parking")}
        accessibilityRole="button"
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
      >
        <View style={styles.ctaIcon}>
          <FileCheck2 size={20} color={colors.slate50} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="h3" color={colors.slate50}>
            Have unused land?
          </Txt>
          <Txt variant="small" color="rgba(250,250,249,0.7)">
            Register it as parking and submit it for approval.
          </Txt>
        </View>
        <ArrowRight size={18} color={colors.slate50} />
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchOverlay: { position: "absolute", top: 12, left: 12, right: 56, height: 46, backgroundColor: colors.white, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.slate300, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, ...shadow },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.slate950 },
  legend: { position: "absolute", left: 12, bottom: 12, backgroundColor: "rgba(255,255,255,0.96)", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.slate200, paddingHorizontal: 10, paddingVertical: 6, flexDirection: "row", flexWrap: "wrap", gap: 12, maxWidth: "80%" },
  cta: { marginTop: space.related, borderRadius: radius.md, backgroundColor: colors.violet, padding: space.card, flexDirection: "row", alignItems: "center", gap: 16 },
  ctaIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: "rgba(250,250,249,0.1)", alignItems: "center", justifyContent: "center" },
});
