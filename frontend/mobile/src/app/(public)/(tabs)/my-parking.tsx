import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { Plus, SquareParking } from "lucide-react-native";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { PagedList } from "@/components/paged-list";
import { ApplicationCard, openApplication } from "@/components/parking";
import { Button, Chips, Empty, Header, Txt } from "@/components/ui";
import { api, formErrors } from "@/lib/api";
import { invalidate, useApi } from "@/lib/queries";
import { colors, radius, space } from "@/lib/theme";
import type { ApplicationDetail, ApplicationSummary, StatusCounts } from "@/lib/types";

type StatusFilter = "all" | "pending" | "changes_requested" | "approved" | "rejected" | "draft";

export default function MyParking() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const counts = useApi<StatusCounts>("/applications/mine/counts");
  const create = useMutation({
    mutationFn: () => api<ApplicationDetail>("/applications", { method: "POST" }),
    onSuccess: (app) => {
      void invalidate("/applications");
      router.push(`/application/${app.id}/edit/location` as never);
    },
    onError: (e) => Alert.alert("Could not start an application", formErrors(e).message ?? undefined),
  });
  const c = counts.data;

  return (
    <PagedList<ApplicationSummary>
      path="/applications/mine"
      query={{ status: status === "all" ? undefined : status }}
      renderItem={(app) => <ApplicationCard app={app} onPress={() => openApplication(app)} />}
      empty={
        <Empty
          icon={<SquareParking size={26} color={colors.blue600} />}
          title={status === "all" ? "You have not registered any land yet" : "No applications with this status"}
          body="Turn unused private land into approved public parking. It takes about 10 minutes."
        />
      }
      header={
        <View>
          <Header title="My Parking" subtitle="Register your land and track government approval" />
          <View style={styles.strip}>
            {[
              [c?.total ?? 0, "Applications"],
              [c?.approved ?? 0, "Approved"],
              [c?.pending ?? 0, "In review"],
              [c?.changes_requested ?? 0, "Need changes"],
            ].map(([n, label], i) => (
              <View key={label} style={[styles.stripItem, i % 2 === 1 && styles.stripLeft, i > 1 && styles.stripTop]}>
                <Txt variant="h1" style={{ fontSize: 30, lineHeight: 32, fontVariant: ["tabular-nums"] }}>
                  {n}
                </Txt>
                <Txt variant="small" style={{ marginTop: 6 }}>
                  {label}
                </Txt>
              </View>
            ))}
          </View>
          <Button title="Add a parking location" icon={<Plus size={18} color={colors.slate50} />} style={{ marginTop: space.related, marginBottom: space.block }} loading={create.isPending} onPress={() => create.mutate()} />
          <Chips<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All", count: c?.total },
              { value: "pending", label: "In review", count: c?.pending },
              { value: "changes_requested", label: "Changes requested", count: c?.changes_requested },
              { value: "approved", label: "Approved", count: c?.approved },
              { value: "rejected", label: "Rejected", count: c?.rejected },
              { value: "draft", label: "Drafts", count: c?.draft },
            ]}
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", flexWrap: "wrap", backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.slate200, overflow: "hidden" },
  stripItem: { width: "50%", paddingHorizontal: space.toolbar, paddingVertical: space.toolbar },
  stripLeft: { borderLeftWidth: 1, borderLeftColor: colors.slate200 },
  stripTop: { borderTopWidth: 1, borderTopColor: colors.slate200 },
});
