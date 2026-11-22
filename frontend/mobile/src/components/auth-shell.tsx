import type { ReactNode } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, fonts, space } from "@/lib/theme";

import { Brand } from "./ui";

export function AuthShell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.slate50 }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Brand subtitle="Kathmandu Valley" />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.lead}>{lead}</Text>
          <View style={{ gap: 20 }}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.gutter + 4, paddingTop: space.block, paddingBottom: 48, flexGrow: 1 },
  title: { marginTop: 48, fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, color: colors.slate950, letterSpacing: -0.6 },
  lead: { fontFamily: fonts.body, fontSize: 15, color: colors.slate600, marginTop: 8, marginBottom: 32, lineHeight: 22 },
});
