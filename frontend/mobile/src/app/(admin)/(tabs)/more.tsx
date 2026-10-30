import { ClipboardList } from "lucide-react-native";
import { View } from "react-native";

import { ProfileView } from "@/components/profile-view";
import { Card, Header, KV, Row, Screen, SectionTitle, Txt } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/queries";
import { colors } from "@/lib/theme";
import type { AuditEntry, Page } from "@/lib/types";

export default function More() {
  const audit = useApi<Page<AuditEntry>>("/admin/audit-logs", { size: 8 });
  return (
    <Screen refreshing={audit.isRefetching} onRefresh={() => audit.refetch()}>
      <Header title="More" subtitle="Administration & settings" />
      <ProfileView
        extra={
          <View>
            <SectionTitle title="Recent activity" action={<ClipboardList size={18} color={colors.slate500} />} />
            <Card>
              {audit.data?.items.map((log) => (
                <KV
                  key={log.id}
                  label={`${log.actor_name ?? "System"} · ${log.action.replace(".", " › ").replace(/_/g, " ")}`}
                  value={
                    <Row>
                      <Txt variant="small">{formatDateTime(log.created_at)}</Txt>
                    </Row>
                  }
                />
              ))}
              {!audit.data?.items.length && <Txt variant="muted">Nothing recorded yet.</Txt>}
            </Card>
          </View>
        }
      />
    </Screen>
  );
}
