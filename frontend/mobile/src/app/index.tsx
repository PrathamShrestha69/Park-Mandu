import { Redirect, router } from "expo-router";
import { ArrowRight, ShieldCheck } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Brand, Dot } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { colors, fonts, radius, space } from "@/lib/theme";

const HOME = { public: "/home", police: "/dashboard", admin: "/overview" } as const;

/** Splash: brand moment, then straight to the right home screen for the signed-in role. */
export default function Splash() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status !== "signedOut") return;
    const timer = setTimeout(() => router.replace("/login"), 1800);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === "signedIn" && user) return <Redirect href={HOME[user.role]} />;

  return (
    <SafeAreaView style={styles.splash}>
      <Brand />
      <View style={{ flex: 1, justifyContent: "center" }}>
        <View style={styles.pill}>
          <Dot color={colors.green500} size={6} />
          <Text style={styles.pillText}>Official service · Kathmandu Valley</Text>
        </View>
        <Text style={styles.title}>Parking that works for the whole valley.</Text>
        <Text style={styles.lead}>Find a verified space, register unused land, and help keep junctions clear.</Text>
      </View>
      <Pressable
        onPress={() => router.replace("/login")}
        accessibilityRole="button"
        accessibilityLabel="Continue to sign in"
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.ctaText}>Get started</Text>
        <ArrowRight size={18} color={colors.white} />
      </Pressable>
      <View style={styles.seal}>
        <ShieldCheck size={14} color={colors.slate600} />
        <Text style={styles.sealText}>Data protected under national digital-service standards</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.slate50, paddingHorizontal: space.gutter + 4, paddingTop: space.block, paddingBottom: space.block },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white, borderRadius: 999, paddingHorizontal: 12, height: 28 },
  pillText: { fontFamily: fonts.medium, fontSize: 12, color: colors.slate600 },
  title: { marginTop: space.block, fontFamily: fonts.semibold, fontSize: 38, lineHeight: 42, letterSpacing: -1.2, color: colors.slate950 },
  lead: { marginTop: space.toolbar, fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.slate600, maxWidth: 340 },
  cta: { height: 52, borderRadius: radius.sm, backgroundColor: colors.violet, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  ctaText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.white },
  seal: { marginTop: space.toolbar, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  sealText: { fontFamily: fonts.body, fontSize: 12, color: colors.slate600 },
});
