import { router } from "expo-router";
import { Cctv, CircleCheck, CircleX, Clock, FileText, SquareParking, TriangleAlert, Users } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { BarChart, RankBars, ShareBar } from "@/components/charts";
import { ApplicationCard } from "@/components/parking";
import { Button, Card, ErrorView, Header, Loading, Screen, SectionTitle, StatCard } from "@/components/ui";
import { todayLong } from "@/lib/format";
import { useApi } from "@/lib/queries";
import { colors } from "@/lib/theme";
import type { ApplicationSummary, DashboardStats, Page } from "@/lib/types";

export default function Overview() {
  const stats = useApi<DashboardStats>("/admin/stats");
  const queue = useApi<Page<ApplicationSummary>>("/admin/applications", { status: "pending", sort: "oldest", size: 3 });

  if (stats.isPending) return <Loading label="Loading statistics…" />;
  if (stats.isError) return <Screen><ErrorView error={stats.error} onRetry={() => stats.refetch()} /></Screen>;
  const { overview: o, charts } = stats.data;

  return (
    <Screen refreshing={stats.isRefetching} onRefresh={() => Promise.all([stats.refetch(), queue.refetch()])}>
      <Header eyebrow={todayLong()} title="Overview" subtitle="Parking registrations, approvals and road monitoring" />

      <View style={styles.stats}>
        <StatCard tone="info" icon={<SquareParking size={20} color={colors.blue700} />} label="Registered parking" value={o.registered_parkings} note={`+${o.registered_this_month} this month`} onPress={() => router.push("/valley-map")} />
        <StatCard tone="warning" icon={<Clock size={20} color={colors.amber700} />} label="Pending applications" value={o.pending_applications} note={`${o.changes_requested} awaiting changes`} onPress={() => router.push("/applications")} />
        <StatCard tone="success" icon={<CircleCheck size={20} color={colors.green700} />} label="Approved" value={o.approved_applications} />
        <StatCard tone="danger" icon={<CircleX size={20} color={colors.red700} />} label="Rejected" value={o.rejected_applications} />
        <StatCard tone="info" icon={<Cctv size={20} color={colors.blue700} />} label="Active CCTV" value={o.cameras_live} note={`of ${o.cameras_total} cameras`} />
        <StatCard tone="danger" icon={<TriangleAlert size={20} color={colors.red700} />} label="Active alerts" value={o.active_alerts} note={`${o.high_priority_alerts} high priority`} />
        <StatCard tone="success" icon={<CircleCheck size={20} color={colors.green700} />} label="Resolved incidents" value={o.resolved_incidents} />
        <StatCard tone="neutral" icon={<Users size={20} color={colors.slate700} />} label="Registered users" value={o.registered_users} onPress={() => router.push("/users")} />
      </View>

      <SectionTitle title="Applications over time" />
      <Card>
        <BarChart
          series={[{ name: "Submitted", color: colors.blue500 }, { name: "Approved", color: colors.green500 }]}
          data={charts.applications_over_time.map((m) => ({ label: m.month, values: [m.submitted, m.approved] }))}
        />
      </Card>

      <SectionTitle title="Approved vs rejected" />
      <Card>
        <ShareBar
          parts={[
            { label: "Approved", value: charts.outcomes.approved, color: colors.green500 },
            { label: "Rejected", value: charts.outcomes.rejected, color: colors.red500 },
            { label: "Changes requested", value: charts.outcomes.changes_requested, color: colors.slate400 },
          ]}
        />
      </Card>

      <SectionTitle title="Illegal parking by area · 30 days" />
      <Card>
        <RankBars data={charts.incidents_by_area.map((a) => ({ label: a.area, value: a.count }))} />
      </Card>

      <SectionTitle title="CCTV activity · detections per day" />
      <Card>
        <BarChart series={[{ name: "Detections", color: colors.blue600 }]} data={charts.cctv_activity.map((d) => ({ label: d.label, values: [d.detections] }))} />
      </Card>

      <SectionTitle title="Waiting longest" />
      <View style={{ gap: 12 }}>
        {queue.data?.items.map((app) => (
          <ApplicationCard key={app.id} app={app} showApplicant onPress={() => router.push(`/review/${app.id}` as never)} />
        ))}
      </View>
      <Button title={`Review ${o.pending_applications} pending applications`} icon={<FileText size={18} color="white" />} style={{ marginTop: 12 }} onPress={() => router.push("/applications")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
});
