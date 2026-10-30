import { FunnelDisplay_600SemiBold } from "@expo-google-fonts/funnel-display";
import { FunnelSans_400Regular, FunnelSans_500Medium, FunnelSans_600SemiBold } from "@expo-google-fonts/funnel-sans";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queries";

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status, user } = useAuth();
  const role = status === "signedIn" ? user?.role : undefined;

  useEffect(() => {
    if (status !== "loading") SplashScreen.hideAsync();
  }, [status]);

  if (status === "loading") return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        {/* Each role only ever sees its own route group; signing out swaps back to the auth screens. */}
        <Stack.Protected guard={!role}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={role === "public"}>
          <Stack.Screen name="(public)" />
        </Stack.Protected>
        <Stack.Protected guard={role === "police"}>
          <Stack.Screen name="(police)" />
        </Stack.Protected>
        <Stack.Protected guard={role === "admin"}>
          <Stack.Screen name="(admin)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    FunnelSans_400Regular,
    FunnelSans_500Medium,
    FunnelSans_600SemiBold,
    FunnelDisplay_600SemiBold,
    IBMPlexMono_500Medium,
  });
  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
