import { Stack } from "expo-router";

import { PaletteContext, policePalette } from "@/lib/theme";

/** Traffic police share the app-wide light theme; the provider stays so the palette can diverge later. */
export default function PoliceLayout() {
  return (
    <PaletteContext value={policePalette}>
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right", contentStyle: { backgroundColor: policePalette.page } }} />
    </PaletteContext>
  );
}
