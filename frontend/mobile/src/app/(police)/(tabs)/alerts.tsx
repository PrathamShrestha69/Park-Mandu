import { Search, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { TextInput, View } from "react-native";

import { PagedList } from "@/components/paged-list";
import { AlertRow } from "@/components/police";
import { Card, Chips, Empty, Header, Row } from "@/components/ui";
import { useApi } from "@/lib/queries";
import { colors, fonts } from "@/lib/theme";
import type { Alert, AlertCounts } from "@/lib/types";

type Status = "open" | "active" | "assigned" | "high" | "resolved" | "all";
type Window = "any" | "1" | "24" | "168";

export default function Alerts() {
  const [status, setStatus] = useState<Status>("open");
  const [window, setWindow] = useState<Window>("any");
  const [area, setArea] = useState("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const counts = useApi<AlertCounts>("/alerts/counts", undefined, { refetchInterval: 15_000 });
  const areas = useApi<string[]>("/alerts/areas");

  const query = {
    status: status === "high" ? "open" : status === "all" ? undefined : status,
    severity: status === "high" ? "high" : undefined,
    within_hours: window === "any" ? undefined : Number(window),
    area: area === "all" ? undefined : area,
    q,
    sort: "severity",
  };

  return (
    <PagedList<Alert>
      path="/alerts"
      query={query}
      size={15}
      refetchInterval={15_000}
      renderItem={(a) => <AlertRow alert={a} />}
      empty={<Empty icon={<TriangleAlert size={26} color="#0859ac" />} title="No alerts match" body="New detections appear here automatically while you are on duty." />}
      header={
        <View>
          <Header title="Parking alerts" subtitle={counts.data ? `${counts.data.open} open · ${counts.data.high_priority} high priority` : "Loading…"} />
          <Card style={{ paddingVertical: 4 }}>
            <Row>
              <Search size={18} color={colors.slate400} />
              <TextInput
                value={text}
                onChangeText={setText}
                onSubmitEditing={() => setQ(text.trim())}
                returnKeyType="search"
                placeholder="Plate number, alert code or road"
                placeholderTextColor={colors.slate500}
                style={{ flex: 1, height: 44, fontFamily: fonts.body, fontSize: 15, color: "white" }}
                accessibilityLabel="Search alerts"
              />
            </Row>
          </Card>
          <Chips<Status>
            value={status}
            onChange={setStatus}
            options={[
              { value: "open", label: "Open", count: counts.data?.open },
              { value: "active", label: "Unassigned", count: counts.data?.active },
              { value: "assigned", label: "Assigned", count: counts.data?.assigned },
              { value: "high", label: "High priority", count: counts.data?.high_priority },
              { value: "resolved", label: "Resolved" },
              { value: "all", label: "All history" },
            ]}
          />
          <Chips<Window>
            value={window}
            onChange={setWindow}
            options={[
              { value: "any", label: "Any time" },
              { value: "1", label: "Last hour" },
              { value: "24", label: "Last 24 h" },
              { value: "168", label: "Last 7 days" },
            ]}
          />
          <Chips value={area} onChange={setArea} options={[{ value: "all", label: "All areas" }, ...(areas.data ?? []).map((a) => ({ value: a, label: a }))]} />
        </View>
      }
    />
  );
}
