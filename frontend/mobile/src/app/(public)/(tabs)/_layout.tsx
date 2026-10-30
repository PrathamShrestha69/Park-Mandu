import { Tabs } from "expo-router";
import { Bell, House, Map, SquareParking, User } from "lucide-react-native";

import { tabOptions } from "@/components/tab-options";
import { useApi } from "@/lib/queries";
import { usePalette } from "@/lib/theme";

export default function PublicTabs() {
  const p = usePalette();
  const unread = useApi<{ unread: number }>("/notifications/unread-count", undefined, { refetchInterval: 60_000 });
  return (
    <Tabs screenOptions={tabOptions(p)}>
      <Tabs.Screen name="home" options={{ title: "Home", tabBarIcon: ({ color }) => <House size={22} color={color} /> }} />
      <Tabs.Screen name="explore" options={{ title: "Map", tabBarIcon: ({ color }) => <Map size={22} color={color} /> }} />
      <Tabs.Screen name="my-parking" options={{ title: "My Parking", tabBarIcon: ({ color }) => <SquareParking size={22} color={color} /> }} />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Notifications",
          tabBarIcon: ({ color }) => <Bell size={22} color={color} />,
          tabBarBadge: unread.data?.unread ? unread.data.unread : undefined,
        }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color }) => <User size={22} color={color} /> }} />
    </Tabs>
  );
}
