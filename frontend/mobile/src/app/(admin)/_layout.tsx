import { Stack } from "expo-router";

import { PaletteContext, lightPalette } from "@/lib/theme";

export default function AdminLayout() {
  return (
    <PaletteContext value={lightPalette}>
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />
    </PaletteContext>
  );
}
