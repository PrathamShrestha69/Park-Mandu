import { router, useLocalSearchParams } from "expo-router";
import { BadgeCheck, CalendarDays, Car, Clock, MapPin, Navigation, SquareParking, TriangleAlert } from "lucide-react-native";
import type { ReactNode } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";

import { MapView } from "@/components/map-view";
import { Badge, Button, Card, ErrorView, Header, KV, Loading, Row, Screen, Txt } from "@/components/ui";
import { DAYS_LABEL, PARKING_TYPE_LABEL, formatDistance, formatHours, formatPrice } from "@/lib/format";
import { useApi } from "@/lib/queries";
import { colors } from "@/lib/theme";
import type { ParkingDetail } from "@/lib/types";

function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <View style={styles.tile}>
      {icon}
      <View style={{ flex: 1 }}>
        <Txt variant="small">{label}</Txt>
        <Txt variant="label">{value}</Txt>
      </View>
    </View>
  );
}

export default function ParkingDetailScreen() {
  const { id, lat, lng } = useLocalSearchParams<{ id: string; lat?: string; lng?: string }>();
  const parking = useApi<ParkingDetail>(`/parkings/${id}`, { lat, lng });

  if (parking.isPending) return <Loading />;
  if (parking.isError) return <Screen><ErrorView error={parking.error} onRetry={() => parking.refetch()} /></Screen>;
  const p = parking.data;
  const unavailable = p.marker_tone === "red";
  const directions = Platform.select({
    ios: `http://maps.apple.com/?daddr=${p.latitude},${p.longitude}`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`,
  });

  return (
    <Screen refreshing={parking.isRefetching} onRefresh={() => parking.refetch()}>
      <Header title={p.name} subtitle={p.address} back />
      <MapView
        height={220}
        center={{ latitude: p.latitude, longitude: p.longitude }}
        zoom={16}
        fit={false}
        points={[{ id: p.id, latitude: p.latitude, longitude: p.longitude, tone: p.marker_tone, kind: "parking", title: p.name, subtitle: formatPrice(p) }]}
      />
      <Card style={{ marginTop: 12, gap: 16 }}>
        <Row style={{ justifyContent: "space-between" }}>
          {unavailable ? <Badge tone="danger">{p.is_open_now ? "Full right now" : "Closed now"}</Badge> : <Badge tone="success" live>{`Open · ${p.available_spaces} spaces`}</Badge>}
          {formatDistance(p.distance_m) && <Badge tone="info">{formatDistance(p.distance_m)}</Badge>}
        </Row>
        <View style={styles.tiles}>
          <Tile icon={<Clock size={16} color={colors.slate600} />} label="Operating hours" value={formatHours(p.opens_at, p.closes_at)} />
          <Tile icon={<SquareParking size={16} color={colors.slate600} />} label="Parking type" value={PARKING_TYPE_LABEL[p.parking_type]} />
          <Tile icon={<Car size={16} color={colors.slate600} />} label="Availability" value={`${p.available_spaces} of ${p.capacity}`} />
          <Tile icon={<CalendarDays size={16} color={colors.slate600} />} label="Open on" value={DAYS_LABEL[p.available_days]} />
        </View>
        <View style={styles.price}>
          <Txt variant="muted" color="rgba(250,250,249,0.7)">
            Parking fee
          </Txt>
          <Txt variant="h2" color={colors.slate50}>
            {formatPrice(p)}
          </Txt>
        </View>
        <View>
          <Row style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <Txt variant="h3">Owner / authority</Txt>
            {p.is_owner_verified && <Badge tone="success">Government verified</Badge>}
          </Row>
          <KV label="Managed by" value={p.managed_by} />
          <KV label="Category" value={p.category === "government" ? "Government / public" : "Approved private"} />
          {p.contact_phone && <KV label="Contact" value={p.contact_phone} />}
        </View>
        <Button title="Get directions" icon={<Navigation size={18} color="white" />} onPress={() => directions && Linking.openURL(directions)} />
        <Button title="Report an issue" variant="ghost" icon={<TriangleAlert size={18} color={colors.slate700} />} onPress={() => router.push(`/report/${p.id}` as never)} />
        <Row gap={6} style={{ justifyContent: "center" }}>
          <BadgeCheck size={14} color={colors.slate500} />
          <Txt variant="small">Availability is reported by the operator and may change.</Txt>
        </Row>
      </Card>
      <Row gap={6} style={{ marginTop: 10, justifyContent: "center" }}>
        <MapPin size={13} color={colors.slate500} />
        <Txt variant="small">{p.area}</Txt>
      </Row>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { flexBasis: "47%", flexGrow: 1, flexDirection: "row", gap: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.slate50 },
  price: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderRadius: 10, backgroundColor: colors.violet },
});
