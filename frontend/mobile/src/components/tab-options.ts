import type { Tabs } from "expo-router";
import type { ComponentProps } from "react";

import { colors, fonts, type Palette } from "@/lib/theme";

type ScreenOptions = NonNullable<ComponentProps<typeof Tabs>["screenOptions"]>;
type TabOptions = Exclude<ScreenOptions, (...args: never[]) => unknown>;

/** Shared bottom-tab styling so every role's navigation feels like one app. */
export function tabOptions(p: Palette): TabOptions {
  return {
    headerShown: false,
    tabBarActiveTintColor: p.heading,
    tabBarInactiveTintColor: p.textMuted,
    tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
    tabBarStyle: { backgroundColor: p.tabBar, borderTopColor: p.border, borderTopWidth: 1, height: 64, paddingTop: 6 },
    tabBarBadgeStyle: { backgroundColor: colors.red500, fontFamily: fonts.mono, fontSize: 10 },
  };
}
