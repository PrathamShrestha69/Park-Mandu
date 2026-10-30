import { Stack } from "expo-router";

import { PaletteContext, lightPalette } from "@/lib/theme";

export default function PublicLayout() {
  return (
    <PaletteContext value={lightPalette}>
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />
    </PaletteContext>
  );
}
