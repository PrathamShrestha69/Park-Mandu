import { router } from "expo-router";
import { FileText, Search } from "lucide-react-native";
import { useState } from "react";
import { TextInput, View } from "react-native";

import { PagedList } from "@/components/paged-list";
import { ApplicationCard } from "@/components/parking";
import { Card, Chips, Empty, Header, Row } from "@/components/ui";
import { useApi } from "@/lib/queries";
import { colors, fonts } from "@/lib/theme";
import type { ApplicationSummary, StatusCounts } from "@/lib/types";

type Status = "pending" | "submitted" | "under_review" | "changes_requested" | "approved" | "rejected" | "all";

export default function Applications() {
  const [status, setStatus] = useState<Status>("pending");
  const [sort, setSort] = useState<"newest" | "oldest" | "capacity">("oldest");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const counts = useApi<StatusCounts>("/admin/applications/counts");
  const c = counts.data;

  return (
    <PagedList<ApplicationSummary>
      path="/admin/applications"
      query={{ status: status === "all" ? undefined : status, q, sort }}
      renderItem={(app) => <ApplicationCard app={app} showApplicant onPress={() => router.push(`/review/${app.id}` as never)} />}
      empty={<Empty icon={<FileText size={26} color={colors.blue600} />} title="No applications match" body="Change the status filter or search." />}
      header={
        <View>
          <Header title="Parking applications" subtitle={c ? `${c.pending} awaiting action` : "Loading…"} />
          <Card style={{ paddingVertical: 4 }}>
            <Row>
              <Search size={18} color={colors.slate500} />
              <TextInput
                value={text}
                onChangeText={setText}
                onSubmitEditing={() => setQ(text.trim())}
                returnKeyType="search"
                placeholder="Reference, applicant, property or address"
                placeholderTextColor={colors.slate500}
                style={{ flex: 1, height: 44, fontFamily: fonts.body, fontSize: 15, color: colors.slate950 }}
                accessibilityLabel="Search applications"
              />
            </Row>
          </Card>
          <Chips<Status>
            value={status}
            onChange={setStatus}
            options={[
              { value: "pending", label: "Pending", count: c?.pending },
              { value: "submitted", label: "New" },
              { value: "under_review", label: "In review" },
              { value: "changes_requested", label: "Changes", count: c?.changes_requested },
              { value: "approved", label: "Approved", count: c?.approved },
              { value: "rejected", label: "Rejected", count: c?.rejected },
              { value: "all", label: "All", count: c?.total },
            ]}
          />
          <Chips
            value={sort}
            onChange={setSort}
            options={[
              { value: "oldest", label: "Waiting longest" },
              { value: "newest", label: "Newest" },
              { value: "capacity", label: "Largest capacity" },
            ]}
          />
        </View>
      }
    />
  );
}
