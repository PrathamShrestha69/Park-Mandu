import { router } from "expo-router";
import { ArrowRight, Bell, FileCheck2, LocateFixed, Map, Search } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { ParkingCard } from "@/components/parking";
import { Button, Callout, Empty, ErrorView, Header, IconButton, Row, Screen, SectionTitle, Stack, Txt } from "@/components/ui";
import { useViewer } from "@/lib/auth";
import { greeting } from "@/lib/format";
import { locationHelp, useMyLocation } from "@/lib/location";
import { useApi } from "@/lib/queries";
import { colors, fonts, radius, space } from "@/lib/theme";
import type { Page, ParkingSummary } from "@/lib/types";

/** Start screen for drivers: the nearest parking that can be used right now, one tap from directions. */
export default function Home() {
  const viewer = useViewer();
  const { coords, status, busy, locate } = useMyLocation();
  const [q, setQ] = useState("");

  const unread = useApi<{ unread: number }>("/notifications/unread-count");
  // With a position: nearest usable parking first. Without one nothing is assumed about where the
  // user is, so the list is simply what is open with free spaces across the valley.
  const nearby = useApi<Page<ParkingSummary>>(
    "/parkings",
    {
      lat: coords?.latitude,
      lng: coords?.longitude,
      radius_m: coords ? 20_000 : undefined,
      available_only: true,
      open_now: true,
      sort: "recommended",
      size: 4,
    },
    { enabled: status !== "checking" || !!coords },
  );
  const locationQuery = coords ? `?lat=${coords.latitude}&lng=${coords.longitude}` : "";
  const help = locationHelp(status);
  const waiting = status === "checking" && !coords;

  const search = () => router.push({ pathname: "/explore", params: q.trim() ? { q: q.trim() } : {} });

  return (
    <Screen refreshing={nearby.isRefetching} onRefresh={() => Promise.all([nearby.refetch(), unread.refetch(), coords ? locate() : Promise.resolve(null)])}>
      <Header
        eyebrow={greeting()}
        title={viewer.full_name}
        right={
          <IconButton label="Notifications" badge={unread.data?.unread} onPress={() => router.push("/notifications")}>
            <Bell size={20} color={colors.slate950} />
          </IconButton>
        }
      />

      <View style={styles.search}>
        <Search size={18} color={colors.slate500} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Where do you want to park?"
          placeholderTextColor={colors.slate500}
          selectionColor={colors.violet}
          returnKeyType="search"
          onSubmitEditing={search}
          style={styles.searchInput}
          accessibilityLabel="Search parking by name, street or area"
        />
      </View>

      <SectionTitle
        title={coords ? "Nearest available parking" : "Available now"}
        action={
          <Button
            title={busy ? "Locating…" : coords ? "Update" : (help?.action ?? "Near me")}
            small
            variant="secondary"
            icon={<LocateFixed size={15} color={colors.slate950} />}
            onPress={() => void locate()}
          />
        }
      />
      {help && (
        <View style={{ marginBottom: space.related }}>
          <Callout title={help.title} icon={<LocateFixed size={16} color={colors.blue700} />}>
            {`${help.body} Showing parking that is open across the valley.`}
          </Callout>
        </View>
      )}

      <Stack>
        {waiting || nearby.isPending ? (
          <Txt variant="muted">{waiting ? "Finding your location…" : "Finding open parking…"}</Txt>
        ) : nearby.isError ? (
          <ErrorView error={nearby.error} onRetry={() => nearby.refetch()} />
        ) : nearby.data.items.length ? (
          nearby.data.items.map((p) => <ParkingCard key={p.id} parking={p} query={locationQuery} />)
        ) : (
          <Empty
            icon={<Search size={20} color={colors.slate600} />}
            title={coords ? "No open parking within 20 km" : "No parking is open right now"}
            body="Open the map to see every location and its opening hours."
          />
        )}
      </Stack>

      <Button title="Open the parking map" icon={<Map size={18} color="white" />} style={{ marginTop: space.toolbar }} onPress={() => router.push("/explore")} />

      <Pressable onPress={() => router.push("/my-parking")} accessibilityRole="button" style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}>
        <View style={styles.ctaIcon}>
          <FileCheck2 size={20} color={colors.slate950} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="h3">Have unused land?</Txt>
          <Txt variant="small">Register it as parking and submit it for approval.</Txt>
        </View>
        <ArrowRight size={18} color={colors.slate600} />
      </Pressable>
      <Row style={{ justifyContent: "center", marginTop: space.related }}>
        <Txt variant="small">Availability is reported by operators and may change.</Txt>
      </Row>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { height: 50, backgroundColor: colors.white, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.slate300, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.slate950, height: 48 },
  cta: { marginTop: space.block, borderRadius: radius.md, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white, padding: space.card, flexDirection: "row", alignItems: "center", gap: 16 },
  ctaIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.slate100, alignItems: "center", justifyContent: "center" },
});
