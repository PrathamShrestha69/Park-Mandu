import { router } from "expo-router";
import { Cctv, Search } from "lucide-react-native";
import { useState } from "react";
import { TextInput, View } from "react-native";

import { PagedList } from "@/components/paged-list";
import { Badge, Card, CctvPreview, Chips, Empty, Header, Row, Txt } from "@/components/ui";
import { CAMERA_STATUS, formatClock } from "@/lib/format";
import { useApi } from "@/lib/queries";
import { colors, fonts } from "@/lib/theme";
import type { Camera, CameraCounts, CameraStatus } from "@/lib/types";

export default function Cameras() {
  const [status, setStatus] = useState<"all" | CameraStatus>("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const counts = useApi<CameraCounts>("/cameras/counts");

  return (
    <PagedList<Camera>
      path="/cameras"
      query={{ q, status: status === "all" ? undefined : status }}
      size={10}
      renderItem={(c) => (
        <Card onPress={() => router.push(`/camera/${c.id}` as never)} style={{ padding: 0, overflow: "hidden" }} accessibilityLabel={`${c.code}, ${CAMERA_STATUS[c.status].label}`}>
          <CctvPreview label={`${c.code} · ${formatClock(c.last_heartbeat_at)}`} offline={c.status !== "live"} detection={c.active_violations ? `${c.active_violations} violation${c.active_violations > 1 ? "s" : ""}` : undefined} height={170} />
          <View style={{ padding: 14, gap: 4 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt variant="h3">{c.code}</Txt>
              <Badge tone={CAMERA_STATUS[c.status].tone} live={c.status === "live"}>
                {CAMERA_STATUS[c.status].label}
              </Badge>
            </Row>
            <Txt variant="muted">{c.name}</Txt>
            <Txt variant="small">
              {formatClock(c.last_heartbeat_at)} · {c.active_violations} active violation{c.active_violations === 1 ? "" : "s"}
            </Txt>
          </View>
        </Card>
      )}
      empty={<Empty icon={<Cctv size={26} color="#0859ac" />} title="No cameras found" body="Try a different road name or camera ID." />}
      header={
        <View>
          <Header title="CCTV Cameras" subtitle={counts.data ? `${counts.data.total} cameras · ${counts.data.live} online` : "Loading…"} />
          <Card style={{ paddingVertical: 4 }}>
            <Row>
              <Search size={18} color={colors.slate400} />
              <TextInput
                value={text}
                onChangeText={setText}
                onSubmitEditing={() => setQ(text.trim())}
                returnKeyType="search"
                placeholder="Search camera ID, road or area"
                placeholderTextColor={colors.slate500}
                style={{ flex: 1, height: 44, fontFamily: fonts.body, fontSize: 15, color: "white" }}
                accessibilityLabel="Search cameras"
              />
            </Row>
          </Card>
          <Chips
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All", count: counts.data?.total },
              { value: "live", label: "Live", count: counts.data?.live },
              { value: "offline", label: "Offline", count: counts.data?.offline },
              { value: "maintenance", label: "Maintenance", count: counts.data?.maintenance },
            ]}
          />
        </View>
      }
    />
  );
}
