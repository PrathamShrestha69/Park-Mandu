import { useMutation } from "@tanstack/react-query";
import { Search, Users as UsersIcon } from "lucide-react-native";
import { useState } from "react";
import { Alert, TextInput, View } from "react-native";

import { PagedList } from "@/components/paged-list";
import { Badge, Button, Card, Chips, Empty, Header, Row, Txt } from "@/components/ui";
import { api, formErrors } from "@/lib/api";
import { useViewer } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { invalidate, useApi } from "@/lib/queries";
import { colors, fonts } from "@/lib/theme";
import type { Role, RoleCounts, User } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = { public: "Public user / Landowner", police: "Traffic police", admin: "Administrator" };
const STATUS_TONE = { active: "success", pending: "warning", suspended: "danger" } as const;

export default function Users() {
  const viewer = useViewer();
  const [role, setRole] = useState<"all" | Role>("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const counts = useApi<RoleCounts>("/admin/users/counts");
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "suspended" }) => api<User>(`/admin/users/${id}`, { method: "PATCH", json: { status } }),
    onSuccess: () => invalidate("/admin/users"),
    onError: (e) => Alert.alert("Could not update", formErrors(e).message ?? undefined),
  });

  return (
    <PagedList<User>
      path="/admin/users"
      query={{ role: role === "all" ? undefined : role, q }}
      renderItem={(u) => {
        const onDuty = u.role === "police" && u.on_duty && u.status === "active";
        const suspend = u.status !== "suspended";
        return (
          <Card>
            <Row gap={12}>
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.blue100, alignItems: "center", justifyContent: "center" }}>
                <Txt variant="label" color={colors.blue700}>
                  {u.initials}
                </Txt>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="h3">{u.full_name}</Txt>
                <Txt variant="small">{u.badge_number ? `${u.designation} · ${u.badge_number}` : ROLE_LABEL[u.role]}</Txt>
                <Txt variant="small">Registered {formatDate(u.created_at)}</Txt>
              </View>
              <View style={{ alignItems: "flex-end", gap: 8 }}>
                <Badge tone={onDuty ? "info" : STATUS_TONE[u.status]}>{onDuty ? "On duty" : u.status[0].toUpperCase() + u.status.slice(1)}</Badge>
                {u.id !== viewer.id && (
                  <Button
                    small
                    variant={suspend ? "ghost" : "secondary"}
                    title={suspend ? "Suspend" : "Reactivate"}
                    onPress={() =>
                      Alert.alert(suspend ? `Suspend ${u.full_name}?` : `Reactivate ${u.full_name}?`, suspend ? "They will be signed out on every device." : undefined, [
                        { text: "Cancel", style: "cancel" },
                        { text: suspend ? "Suspend" : "Reactivate", style: suspend ? "destructive" : "default", onPress: () => setStatus.mutate({ id: u.id, status: suspend ? "suspended" : "active" }) },
                      ])
                    }
                  />
                )}
              </View>
            </Row>
          </Card>
        );
      }}
      empty={<Empty icon={<UsersIcon size={26} color={colors.blue600} />} title="No users found" body="Try another name or role." />}
      header={
        <View>
          <Header title="User management" subtitle={counts.data ? `${counts.data.total} registered service users` : "Loading…"} />
          <Card style={{ paddingVertical: 4 }}>
            <Row>
              <Search size={18} color={colors.slate500} />
              <TextInput
                value={text}
                onChangeText={setText}
                onSubmitEditing={() => setQ(text.trim())}
                returnKeyType="search"
                placeholder="Name, phone, email or badge"
                placeholderTextColor={colors.slate500}
                style={{ flex: 1, height: 44, fontFamily: fonts.body, fontSize: 15, color: colors.slate950 }}
                accessibilityLabel="Search users"
              />
            </Row>
          </Card>
          <Chips
            value={role}
            onChange={setRole}
            options={[
              { value: "all", label: "All", count: counts.data?.total },
              { value: "public", label: "Public", count: counts.data?.public },
              { value: "police", label: "Police", count: counts.data?.police },
              { value: "admin", label: "Admin", count: counts.data?.admin },
            ]}
          />
        </View>
      }
    />
  );
}
