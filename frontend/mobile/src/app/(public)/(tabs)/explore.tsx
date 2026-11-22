import { router, useLocalSearchParams } from "expo-router";
import { BadgeCheck, ChevronRight, Clock, LocateFixed, MapPin, Navigation, Search, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomSheet } from "@/components/bottom-sheet";
import { MapView, type MapPoint } from "@/components/map-view";
import { NavigationPanel } from "@/components/navigation-panel";
import { AvailabilityBadge } from "@/components/parking";
import { Button, Dot, ErrorView, Row, Txt } from "@/components/ui";
import { formatDistance, formatHours, formatPrice } from "@/lib/format";
import { locationHelp, useMyLocation } from "@/lib/location";
import { useParkingNavigation } from "@/lib/use-navigation";
import { api } from "@/lib/api";
import { useApi, usePaged } from "@/lib/queries";
import { colors, fonts, radius, shadow, space, usePalette } from "@/lib/theme";
import type { MapMarker, ParkingDetail, ParkingSummary } from "@/lib/types";

type NavTarget = { id: string; name: string; latitude: number; longitude: number; tone: ParkingSummary["marker_tone"] };

type Toggle = "available" | "government" | "private" | "free" | "car" | "bike" | "other" | "proposed";

const VEHICLE_TOGGLES: Toggle[] = ["car", "bike", "other"];

const TOGGLES: { key: Toggle; label: string; dot?: string }[] = [
  { key: "available", label: "Available now", dot: colors.green500 },
  { key: "government", label: "Government", dot: colors.blue600 },
  { key: "private", label: "Private" },
  { key: "free", label: "Free" },
  { key: "car", label: "Car" },
  { key: "bike", label: "Bike" },
  { key: "other", label: "Other vehicles" },
  { key: "proposed", label: "Awaiting approval", dot: colors.slate400 },
];

const SHEET_PEEK = 92;

export default function Explore() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string; navigate?: string }>();
  const { coords, status, busy, locate } = useMyLocation();
  const nav = useParkingNavigation();
  const [target, setTarget] = useState<NavTarget | null>(null);

  const [text, setText] = useState(params.q ?? "");
  const [q, setQ] = useState(params.q ?? "");
  // "Available now" is on from the start: a driver wants somewhere to park, not a full inventory.
  const [active, setActive] = useState<Set<Toggle>>(new Set(["available"]));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState(1);
  const [areaHeight, setAreaHeight] = useState(0);
  const [recenterKey, setRecenterKey] = useState(0);

  const flip = (key: Toggle) =>
    setActive((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        // A place is either government or private, so these two replace each other.
        if (key === "government") next.delete("private");
        if (key === "private") next.delete("government");
        // One vehicle type at a time: "parking that takes my bike".
        if (VEHICLE_TOGGLES.includes(key)) VEHICLE_TOGGLES.filter((v) => v !== key).forEach((v) => next.delete(v));
      }
      return next;
    });

  const query = {
    q,
    category: active.has("government") ? "government" : active.has("private") ? "private" : undefined,
    available_only: active.has("available"),
    open_now: active.has("available"),
    free_only: active.has("free"),
    vehicle_type: VEHICLE_TOGGLES.find((v) => active.has(v)),
    lat: coords?.latitude,
    lng: coords?.longitude,
    radius_m: coords ? 50_000 : undefined,
    sort: "recommended",
  };
  const list = usePaged<ParkingSummary>("/parkings", query, { size: 25, refetchInterval: 60_000 });
  const directions = (p: NavTarget) => {
    setTarget(p);
    setSheet(1);
    nav.begin({ latitude: p.latitude, longitude: p.longitude });
  };
  // "Get directions" on a parking's page opens this map with ?navigate=<id>.
  const navigateTo = params.navigate;
  useEffect(() => {
    if (!navigateTo) return;
    let cancelled = false;
    api<ParkingDetail>(`/parkings/${navigateTo}`)
      .then((p) => {
        if (cancelled) return;
        directions({ id: p.id, name: p.name, latitude: p.latitude, longitude: p.longitude, tone: p.marker_tone });
        router.setParams({ navigate: undefined });
      })
      .catch(() => undefined); // unknown parking: the map simply opens as usual
    return () => {
      cancelled = true;
    };
    // Runs once per requested parking; `directions` is a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateTo]);
  const proposed = useApi<MapMarker[]>("/parkings/map", undefined, { enabled: active.has("proposed") });

  const points = useMemo<MapPoint[]>(() => {
    const parking = list.items.map((item) => ({
      id: item.id,
      latitude: item.latitude,
      longitude: item.longitude,
      tone: item.marker_tone,
      kind: "parking" as const,
      title: item.name,
      subtitle: `${item.available_spaces} of ${item.capacity} spaces · ${formatPrice(item)}`,
    }));
    const pending = active.has("proposed")
      ? (proposed.data ?? [])
          .filter((m) => m.kind === "pending")
          .map((m) => ({ id: m.id, latitude: m.latitude, longitude: m.longitude, tone: m.tone, kind: m.kind, title: m.name, subtitle: m.subtitle }))
      : [];
    const all = [...parking, ...pending];
    // The parking being navigated to stays on the map even when filters would hide it.
    if (target && !all.some((p) => p.id === target.id)) {
      all.push({ id: target.id, latitude: target.latitude, longitude: target.longitude, tone: target.tone, kind: "parking", title: target.name, subtitle: "Destination" });
    }
    return all;
  }, [list.items, proposed.data, active, target]);

  const selected = list.items.find((item) => item.id === selectedId) ?? null;
  const selectedProposal = !selected && selectedId ? (points.find((point) => point.id === selectedId && point.kind === "pending") ?? null) : null;

  // The sheet never grows past the search bar and filter row above it.
  const topArea = insets.top + 112;
  const snapPoints = useMemo(() => {
    const full = Math.max(SHEET_PEEK + 120, areaHeight - topArea);
    const half = Math.min(full, Math.max(SHEET_PEEK + 150, Math.round(areaHeight * 0.44)));
    return [SHEET_PEEK, half, full];
  }, [areaHeight, topArea]);

  const select = (id: string) => {
    Keyboard.dismiss();
    setSelectedId(id);
    setSheet((current) => (current === 2 ? 1 : Math.max(current, 1)));
  };

  const help = locationHelp(status);
  const total = list.total;
  const title = target ? "Directions" : selected || selectedProposal ? "Selected place" : list.isPending ? "Finding parking…" : `${total} parking place${total === 1 ? "" : "s"}`;
  const subtitle = selected || selectedProposal ? "Tap the map to go back to the list" : coords ? "Nearest available first" : "Available first · turn on location for distances";

  return (
    <View style={{ flex: 1, backgroundColor: p.page }} onLayout={(e) => setAreaHeight(e.nativeEvent.layout.height)}>
      <MapView
        fill
        selectOnTap
        points={points}
        me={nav.me ?? coords}
        fitCount={coords ? 6 : undefined}
        selectedId={target?.id ?? selectedId}
        route={nav.route?.geometry ?? null}
        routeFitKey={nav.fitKey}
        follow={nav.phase === "navigating"}
        bottomPadding={snapPoints[Math.min(sheet, 1)]}
        recenterKey={recenterKey}
        onSelect={(point) => select(point.id)}
        onDeselect={() => setSelectedId(null)}
      />

      <View style={[styles.top, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Row gap={8}>
          <View style={[styles.search, { backgroundColor: p.surface, borderColor: p.input }]}>
            <Search size={18} color={colors.slate500} />
            <TextInput
              value={text}
              onChangeText={setText}
              onSubmitEditing={() => {
                setQ(text.trim());
                setSelectedId(null);
              }}
              returnKeyType="search"
              placeholder="Search name, street or area"
              placeholderTextColor={colors.slate500}
              selectionColor={p.brand}
              style={[styles.searchInput, { color: p.text }]}
              accessibilityLabel="Search parking"
            />
            {text.length > 0 && (
              <Pressable
                onPress={() => {
                  setText("");
                  setQ("");
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <X size={18} color={colors.slate500} />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={async () => {
              if (coords) setRecenterKey((key) => key + 1);
              else if (await locate()) setRecenterKey((key) => key + 1);
            }}
            accessibilityRole="button"
            accessibilityLabel={coords ? "Centre the map on my location" : (help?.action ?? "Use my location")}
            style={[styles.locate, { backgroundColor: p.surface, borderColor: p.input }]}
          >
            {busy ? <ActivityIndicator size="small" color={p.brand} /> : <LocateFixed size={20} color={coords ? p.brand : colors.slate600} />}
          </Pressable>
        </Row>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={{ gap: 6, paddingHorizontal: space.gutter }} keyboardShouldPersistTaps="handled">
          {TOGGLES.map((toggle) => {
            const on = active.has(toggle.key);
            return (
              <Pressable
                key={toggle.key}
                onPress={() => {
                  flip(toggle.key);
                  setSelectedId(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.chip, { backgroundColor: on ? p.brand : p.surface, borderColor: on ? p.brand : p.input }]}
              >
                {toggle.dot && !on && <Dot color={toggle.dot} />}
                <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: on ? p.inkForeground : p.text }}>{toggle.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {areaHeight > 0 && (
        <BottomSheet
          snapPoints={snapPoints}
          index={sheet}
          onIndexChange={setSheet}
          header={
            <View style={styles.sheetHeader}>
              <Txt variant="h2">{title}</Txt>
              <Txt variant="small" numberOfLines={1}>
                {subtitle}
              </Txt>
            </View>
          }
        >
          {target ? (
            <ScrollView contentContainerStyle={styles.sheetBody}>
              <NavigationPanel nav={nav} name={target.name} onClose={() => setTarget(null)} />
            </ScrollView>
          ) : selected ? (
            <ScrollView contentContainerStyle={styles.sheetBody}>
              <SelectedParking
                parking={selected}
                locationQuery={coords ? `?lat=${coords.latitude}&lng=${coords.longitude}` : ""}
                onClose={() => setSelectedId(null)}
                onDirections={() => directions({ id: selected.id, name: selected.name, latitude: selected.latitude, longitude: selected.longitude, tone: selected.marker_tone })}
              />
            </ScrollView>
          ) : selectedProposal ? (
            <View style={styles.sheetBody}>
              <Row style={{ alignItems: "flex-start" }}>
                <View style={[styles.tile, { backgroundColor: colors.slate100 }]}>
                  <Clock size={18} color={colors.slate600} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="h3">{selectedProposal.title}</Txt>
                  <Txt variant="muted">This location has applied to become parking and is waiting for government approval. It cannot be used yet.</Txt>
                </View>
              </Row>
            </View>
          ) : (
            <FlatList
              data={list.items}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <ResultRow parking={item} onPress={() => select(item.id)} />}
              ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border }} />}
              ListHeaderComponent={
                <View>
                  {help && (
                    <Pressable onPress={() => void locate()} accessibilityRole="button" style={[styles.help, { backgroundColor: colors.blue50 }]}>
                      <LocateFixed size={16} color={colors.blue700} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.helpTitle}>{help.title}</Text>
                        <Text style={styles.helpBody}>{help.body}</Text>
                      </View>
                      <Text style={styles.helpAction}>{help.action}</Text>
                    </Pressable>
                  )}
                  <Row gap={12} style={styles.legend}>
                    {[
                      [colors.green500, "Available"],
                      [colors.blue600, "Government"],
                      [colors.red500, "Full or closed"],
                    ].map(([color, label]) => (
                      <Row key={label} gap={5}>
                        <Dot color={color} />
                        <Txt variant="small" style={{ fontSize: 11 }}>
                          {label}
                        </Txt>
                      </Row>
                    ))}
                  </Row>
                </View>
              }
              ListEmptyComponent={
                list.isPending ? (
                  <ActivityIndicator color={p.primary} style={{ marginTop: 24 }} />
                ) : list.isError ? (
                  <View style={{ padding: space.gutter }}>
                    <ErrorView error={list.error} onRetry={() => list.refetch()} />
                  </View>
                ) : (
                  <View style={{ padding: 24, alignItems: "center", gap: 6 }}>
                    <Txt variant="h3">No parking matches</Txt>
                    <Txt variant="muted" style={{ textAlign: "center" }}>
                      {active.has("available") ? "Nothing is open with free spaces right now. Turn off “Available now” to see every location." : "Try another area or remove a filter."}
                    </Txt>
                  </View>
                )
              }
              ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={p.primary} style={{ marginVertical: 14 }} /> : undefined}
              onEndReachedThreshold={0.4}
              onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
            />
          )}
        </BottomSheet>
      )}
    </View>
  );
}

/** One line per result: what a driver compares at a glance — name, distance, price, availability. */
function ResultRow({ parking, onPress }: { parking: ParkingSummary; onPress: () => void }) {
  const distance = formatDistance(parking.distance_m);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${parking.name}, ${distance ?? parking.area}`} style={({ pressed }) => [styles.result, pressed && { backgroundColor: colors.slate100 }]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Row gap={6}>
          <Txt variant="h3" numberOfLines={1} style={{ flexShrink: 1 }}>
            {parking.name}
          </Txt>
          {parking.category === "government" && <BadgeCheck size={15} color={colors.blue600} accessibilityLabel="Government verified" />}
        </Row>
        <Txt variant="small" numberOfLines={1}>
          {[distance, parking.area, formatPrice(parking)].filter(Boolean).join(" · ")}
        </Txt>
      </View>
      <AvailabilityBadge parking={parking} />
      <ChevronRight size={18} color={colors.slate400} />
    </Pressable>
  );
}

function SelectedParking({
  parking,
  locationQuery,
  onClose,
  onDirections,
}: {
  parking: ParkingSummary;
  locationQuery: string;
  onClose: () => void;
  onDirections: () => void;
}) {
  const distance = formatDistance(parking.distance_m);
  return (
    <View style={{ gap: 14 }}>
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="h2">{parking.name}</Txt>
          <Row gap={4} style={{ alignItems: "flex-start" }}>
            <MapPin size={13} color={colors.slate500} style={{ marginTop: 2 }} />
            <Txt variant="small" style={{ flex: 1 }}>
              {parking.address}
            </Txt>
          </Row>
        </View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to the list" style={styles.close}>
          <X size={18} color={colors.slate600} />
        </Pressable>
      </Row>
      <Row gap={6} style={{ flexWrap: "wrap" }}>
        <AvailabilityBadge parking={parking} />
        {parking.category === "government" && (
          <View style={styles.verified}>
            <BadgeCheck size={13} color={colors.blue700} />
            <Text style={styles.verifiedText}>Government verified</Text>
          </View>
        )}
      </Row>
      <View style={styles.facts}>
        <Fact label="Fee" value={formatPrice(parking)} />
        <Fact label="Distance" value={distance ?? "—"} />
        <Fact label="Hours" value={formatHours(parking.opens_at, parking.closes_at)} />
      </View>
      <Row gap={8}>
        <Button title="Directions" icon={<Navigation size={18} color="white" />} style={{ flex: 1 }} onPress={onDirections} />
        <Button title="Details" variant="secondary" style={{ flex: 1 }} onPress={() => router.push(`/parking/${parking.id}${locationQuery}` as never)} />
      </Row>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Txt variant="small">{label}</Txt>
      <Txt variant="label" numberOfLines={1}>
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: "absolute", left: 0, right: 0, gap: 8 },
  search: { flex: 1, height: 46, marginLeft: space.gutter, borderRadius: radius.sm, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, ...shadow },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 16, height: 44 },
  locate: { width: 46, height: 46, marginRight: space.gutter, borderRadius: radius.sm, borderWidth: 1, alignItems: "center", justifyContent: "center", ...shadow },
  filters: { flexGrow: 0 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1 },
  sheetHeader: { paddingHorizontal: space.gutter, paddingBottom: 12, gap: 2 },
  sheetBody: { paddingHorizontal: space.gutter, paddingBottom: 20 },
  result: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: space.gutter, paddingVertical: 13, minHeight: 60 },
  legend: { paddingHorizontal: space.gutter, paddingBottom: 8 },
  help: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: space.gutter, marginBottom: 10, padding: 12, borderRadius: radius.sm },
  helpTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.blue700 },
  helpBody: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.blue700 },
  helpAction: { fontFamily: fonts.semibold, fontSize: 12, color: colors.blue700, textDecorationLine: "underline" },
  tile: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.slate100, alignItems: "center", justifyContent: "center" },
  verified: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingHorizontal: 8, borderRadius: 6, backgroundColor: colors.blue50, borderWidth: 1, borderColor: "#bcdcfb" },
  verifiedText: { fontFamily: fonts.medium, fontSize: 12, color: colors.blue700 },
  facts: { flexDirection: "row", gap: 8 },
  fact: { flex: 1, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.slate50, gap: 2 },
});
