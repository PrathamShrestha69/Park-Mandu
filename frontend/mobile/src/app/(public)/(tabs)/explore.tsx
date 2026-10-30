import { router, useLocalSearchParams } from "expo-router";
import { Search } from "lucide-react-native";
import { useState } from "react";
import { TextInput, View } from "react-native";

import { MapView } from "@/components/map-view";
import { PagedList } from "@/components/paged-list";
import { ParkingCard } from "@/components/parking";
import { Card, Chips, Empty, Header, Row } from "@/components/ui";
import { useApi } from "@/lib/queries";
import { colors, fonts } from "@/lib/theme";
import type { MapMarker, ParkingSummary } from "@/lib/types";

type Category = "all" | "government" | "private";
type Filter = "all" | "available" | "open_now" | "free";

export default function Explore() {
  const params = useLocalSearchParams<{ q?: string; lat?: string; lng?: string }>();
  const [text, setText] = useState(params.q ?? "");
  const [q, setQ] = useState(params.q ?? "");
  const [category, setCategory] = useState<Category>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const hasOrigin = !!(params.lat && params.lng);
  const [sort, setSort] = useState<"distance" | "name" | "available" | "price">(hasOrigin ? "distance" : "name");
  const locationQuery = hasOrigin ? `?lat=${params.lat}&lng=${params.lng}` : "";

  const query = {
    q,
    category: category === "all" ? undefined : category,
    available_only: filter === "available",
    open_now: filter === "open_now",
    free_only: filter === "free",
    lat: params.lat,
    lng: params.lng,
    radius_m: hasOrigin ? 20_000 : undefined,
    sort,
  };

  return (
    <PagedList<ParkingSummary>
      path="/parkings"
      query={query}
      size={10}
      renderItem={(p) => <ParkingCard parking={p} query={locationQuery} />}
      empty={<Empty icon={<Search size={24} color={colors.blue600} />} title="No parking matches" body="Try a nearby area or remove a filter." />}
      header={
        <View>
          <Header title="Find parking" subtitle="Verified public and private parking across the valley" />
          <Card style={{ paddingVertical: 4 }}>
            <Row>
              <Search size={18} color={colors.slate500} />
              <TextInput
                value={text}
                onChangeText={setText}
                onSubmitEditing={() => setQ(text.trim())}
                returnKeyType="search"
                placeholder="Name, street or area (e.g. Thamel)"
                placeholderTextColor={colors.slate500}
                style={{ flex: 1, height: 44, fontFamily: fonts.body, fontSize: 15, color: colors.slate950 }}
                accessibilityLabel="Search parking"
              />
            </Row>
          </Card>
          <Chips<Category>
            value={category}
            onChange={setCategory}
            options={[
              { value: "all", label: "All parking" },
              { value: "government", label: "Government" },
              { value: "private", label: "Approved private" },
            ]}
          />
          <Chips<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "Any time" },
              { value: "open_now", label: "Open now" },
              { value: "available", label: "Spaces available" },
              { value: "free", label: "Free" },
            ]}
          />
          <Chips
            value={sort}
            onChange={setSort}
            options={[...(hasOrigin ? [{ value: "distance" as const, label: "Nearest" }] : []), { value: "name", label: "A–Z" }, { value: "available", label: "Most spaces" }, { value: "price", label: "Lowest price" }]}
          />
          <ValleyMap locationQuery={locationQuery} me={hasOrigin ? { latitude: Number(params.lat), longitude: Number(params.lng) } : null} />
        </View>
      }
    />
  );
}

/** Every published parking location plus pending applications; tap a pin to open it. */
function ValleyMap({ locationQuery, me }: { locationQuery: string; me: { latitude: number; longitude: number } | null }) {
  const markers = useApi<MapMarker[]>("/parkings/map");
  return (
    <MapView
      height={240}
      me={me}
      style={{ marginBottom: 14 }}
      points={(markers.data ?? []).map((m) => ({ id: m.id, latitude: m.latitude, longitude: m.longitude, tone: m.tone, kind: m.kind, title: m.name, subtitle: m.subtitle }))}
      onSelect={(point) => point.kind === "parking" && router.push(`/parking/${point.id}${locationQuery}` as never)}
    />
  );
}
