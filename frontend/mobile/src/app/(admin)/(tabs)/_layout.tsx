import { Tabs } from "expo-router";
import { FileText, LayoutDashboard, Map, Menu, Users } from "lucide-react-native";

import { tabOptions } from "@/components/tab-options";
import { useApi } from "@/lib/queries";
import { usePalette } from "@/lib/theme";
import type { StatusCounts } from "@/lib/types";

export default function AdminTabs() {
  const p = usePalette();
  const counts = useApi<StatusCounts>("/admin/applications/counts", undefined, { refetchInterval: 60_000 });
  return (
    <Tabs screenOptions={tabOptions(p)}>
      <Tabs.Screen name="overview" options={{ title: "Overview", tabBarIcon: ({ color }) => <LayoutDashboard size={22} color={color} /> }} />
      <Tabs.Screen
        name="applications"
        options={{ title: "Applications", tabBarIcon: ({ color }) => <FileText size={22} color={color} />, tabBarBadge: counts.data?.pending || undefined }}
      />
      <Tabs.Screen name="valley-map" options={{ title: "Map", tabBarIcon: ({ color }) => <Map size={22} color={color} /> }} />
      <Tabs.Screen name="users" options={{ title: "Users", tabBarIcon: ({ color }) => <Users size={22} color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: ({ color }) => <Menu size={22} color={color} /> }} />
    </Tabs>
  );
}
