import type { Tabs } from "expo-router";
import { createContext, useContext, type ComponentProps } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, usePalette } from "@/lib/theme";

type ScreenOptions = NonNullable<ComponentProps<typeof Tabs>["screenOptions"]>;
type TabOptions = Exclude<ScreenOptions, (...args: never[]) => unknown>;

/** Height of the tab bar's own content (icon + label), without the device's bottom inset. */
const TAB_BAR_CONTENT_HEIGHT = 58;

/**
 * True for screens rendered inside a bottom-tab navigator. There the tab bar already sits above the
 * system navigation area, so screens must not add the bottom inset a second time; screens pushed on
 * top of the tabs have no tab bar and must keep clear of it themselves.
 */
export const InsideTabs = createContext(false);

/** Space a screen has to leave free at its bottom edge for the system navigation bar / home indicator. */
export function useBottomInset(): number {
  const insets = useSafeAreaInsets();
  return useContext(InsideTabs) ? 0 : insets.bottom;
}

/**
 * Shared bottom-tab styling so every role's navigation feels like one app. The bar grows by the
 * device's bottom inset (gesture bar, three-button bar, iPhone home indicator): a fixed height
 * squeezed the labels into that area and let them collide with the system navigation.
 */
export function useTabOptions(): TabOptions {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return {
    headerShown: false,
    tabBarActiveTintColor: p.heading,
    tabBarInactiveTintColor: p.textMuted,
    tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
    tabBarAllowFontScaling: false,
    tabBarHideOnKeyboard: true,
    tabBarStyle: {
      backgroundColor: p.tabBar,
      borderTopColor: p.border,
      borderTopWidth: 1,
      height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
      paddingTop: 6,
      paddingBottom: insets.bottom,
    },
    tabBarBadgeStyle: { backgroundColor: colors.red500, fontFamily: fonts.mono, fontSize: 10 },
    sceneStyle: { backgroundColor: p.page },
  };
}
