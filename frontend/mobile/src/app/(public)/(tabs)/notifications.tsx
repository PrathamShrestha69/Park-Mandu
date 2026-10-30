import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { Bell, CircleCheck, Clock, FileText, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { PagedList } from "@/components/paged-list";
import { Card, Chips, Empty, Header, Row, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { invalidate, useApi } from "@/lib/queries";
import { colors, toneColors, type Tone } from "@/lib/theme";
import type { Notification } from "@/lib/types";

const ICON = { info: FileText, success: CircleCheck, warning: Clock, danger: TriangleAlert };

export default function Notifications() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const unread = useApi<{ unread: number }>("/notifications/unread-count");
  const readAll = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "POST" }),
    onSuccess: () => invalidate("/notifications"),
  });
  const open = useMutation({
    mutationFn: (n: Notification) => api(`/notifications/${n.id}/read`, { method: "POST" }),
    onSettled: () => invalidate("/notifications"),
  });

  return (
    <PagedList<Notification>
      path="/notifications"
      query={{ unread_only: filter === "unread" }}
      renderItem={(n) => {
        const Icon = ICON[n.tone];
        const tone = toneColors[n.tone as Tone];
        return (
          <Card
            onPress={() => {
              open.mutate(n);
              if (n.entity_type === "application" && n.entity_id) router.push(`/application/${n.entity_id}` as never);
            }}
            style={!n.read_at ? { borderColor: colors.blue100, backgroundColor: colors.blue50 } : undefined}
            accessibilityLabel={`${n.read_at ? "" : "Unread. "}${n.title}`}
          >
            <Row style={{ alignItems: "flex-start" }} gap={12}>
              <View style={[styles.icon, { backgroundColor: tone.bg }]}>
                <Icon size={20} color={tone.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Txt variant="h3" style={{ flex: 1, fontSize: 14 }}>
                    {n.title}
                  </Txt>
                  <Txt variant="small" style={{ fontSize: 11 }}>
                    {timeAgo(n.created_at)}
                  </Txt>
                </Row>
                <Txt variant="muted" style={{ marginTop: 3 }}>
                  {n.body}
                </Txt>
              </View>
              {!n.read_at && <View style={styles.unread} />}
            </Row>
          </Card>
        );
      }}
      empty={<Empty icon={<Bell size={26} color={colors.blue600} />} title={filter === "unread" ? "You're all caught up" : "No notifications yet"} body="Updates about your parking applications will appear here." />}
      header={
        <View>
          <Header
            title="Notifications"
            subtitle="Updates about your Park Mandu services"
            right={
              unread.data?.unread ? (
                <Pressable onPress={() => readAll.mutate()} accessibilityRole="button" hitSlop={8}>
                  <Txt variant="label" color={colors.blue600}>
                    Mark all read
                  </Txt>
                </Pressable>
              ) : undefined
            }
          />
          <Chips
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "unread", label: "Unread", count: unread.data?.unread },
            ]}
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  unread: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.blue600, marginTop: 6 },
});
