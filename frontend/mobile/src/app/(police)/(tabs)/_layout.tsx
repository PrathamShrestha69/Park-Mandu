import { Tabs } from "expo-router";
import { Cctv, LayoutDashboard, Siren, TriangleAlert, User } from "lucide-react-native";

import { InsideTabs, useTabOptions } from "@/components/tab-options";
import { useApi } from "@/lib/queries";
import type { AlertCounts } from "@/lib/types";

export default function PoliceTabs() {
  const options = useTabOptions();
  const counts = useApi<AlertCounts>("/alerts/counts", undefined, { refetchInterval: 15_000 });
  return (
    <InsideTabs value>
    <Tabs screenOptions={options}>
      <Tabs.Screen name="dashboard" options={{ title: "Dashboard", tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} /> }} />
      <Tabs.Screen name="cameras" options={{ title: "Cameras", tabBarIcon: ({ color }) => <Cctv size={22} color={color} /> }} />
      <Tabs.Screen
        name="alerts"
        options={{ title: "Alerts", tabBarIcon: ({ color }) => <TriangleAlert size={22} color={color} />, tabBarBadge: counts.data?.active || undefined }}
      />
      <Tabs.Screen name="incidents" options={{ title: "Incidents", tabBarIcon: ({ color }) => <Siren size={22} color={color} /> }} />
      <Tabs.Screen name="officer" options={{ title: "Profile", tabBarIcon: ({ color }) => <User size={22} color={color} /> }} />
    </Tabs>
    </InsideTabs>
  );
}
