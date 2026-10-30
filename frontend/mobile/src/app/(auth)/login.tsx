import { Link } from "expo-router";
import { ChartColumn, KeyRound, Lock, Phone, Siren, SquareParking, User } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AuthShell } from "@/components/auth-shell";
import { Button, Field, FormMessage } from "@/components/ui";
import { api, formErrors } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, fonts } from "@/lib/theme";
import type { AuthResponse, CodeSent } from "@/lib/types";

const DEMO = [
  { identifier: "sita.sharma@example.com", role: "Public user / Landowner", detail: "Sita Sharma", icon: SquareParking },
  { identifier: "TP-2841", role: "Traffic police", detail: "Inspector Rajendra Karki", icon: Siren },
  { identifier: "nabin.shrestha@parkmandu.test", role: "Government administrator", detail: "Nabin Shrestha", icon: ChartColumn },
];

export default function Login() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string | null; fields: Record<string, string> }>({ message: null, fields: {} });

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError({ message: null, fields: {} });
    try {
      await work();
    } catch (e) {
      setError(formErrors(e));
    } finally {
      setBusy(false);
    }
  };

  const loginWith = (id: string, pass: string) =>
    run(async () => signIn(await api<AuthResponse>("/auth/login", { method: "POST", json: { identifier: id, password: pass }, auth: false })));

  return (
    <AuthShell title="Welcome back" lead="Sign in to access parking and traffic services. Your role is detected automatically.">
      <View style={styles.segmented} accessibilityRole="tablist">
        {(["password", "otp"] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[styles.segment, mode === m && styles.segmentActive]} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
            <Text style={[styles.segmentText, mode === m && { color: colors.violet }]}>{m === "password" ? "Password" : "One-time code"}</Text>
          </Pressable>
        ))}
      </View>

      {mode === "password" ? (
        <>
          <Field
            label="Phone number, email or badge number"
            icon={<User size={18} color={colors.slate500} />}
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoComplete="username"
            placeholder="98XXXXXXXX or name@example.com"
            error={error.fields.identifier}
          />
          <Field label="Password" icon={<Lock size={18} color={colors.slate500} />} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" error={error.fields.password} />
          <Link href="/forgot" style={styles.link}>
            Forgot password?
          </Link>
          <FormMessage message={error.message} />
          <Button title="Sign in securely" loading={busy} onPress={() => loginWith(identifier.trim(), password)} />
        </>
      ) : codeSent ? (
        <>
          <FormMessage ok message={codeSent} />
          <Field label="6-digit code" icon={<KeyRound size={18} color={colors.slate500} />} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="sms-otp" maxLength={6} error={error.fields.code} />
          <FormMessage message={error.message} />
          <Button
            title="Verify and sign in"
            loading={busy}
            onPress={() => run(async () => signIn(await api<AuthResponse>("/auth/otp/verify", { method: "POST", json: { phone, code }, auth: false })))}
          />
          <Button title="Use a different number" variant="ghost" onPress={() => setCodeSent(null)} />
        </>
      ) : (
        <>
          <Field label="Registered phone number" icon={<Phone size={18} color={colors.slate500} />} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98XXXXXXXX" error={error.fields.phone} />
          <FormMessage message={error.message} />
          <Button
            title="Send one-time code"
            loading={busy}
            onPress={() =>
              run(async () => {
                const sent = await api<CodeSent>("/auth/otp/request", { method: "POST", json: { phone }, auth: false });
                setCodeSent(sent.dev_code ? `${sent.message} Development code: ${sent.dev_code}` : sent.message);
              })
            }
          />
        </>
      )}

      {__DEV__ && (
        <View style={styles.demo}>
          <Text style={styles.demoTitle}>Demo accounts (development)</Text>
          {DEMO.map((d) => (
            <Pressable key={d.identifier} style={styles.demoRow} onPress={() => loginWith(d.identifier, "ParkMandu@2026")} accessibilityRole="button" accessibilityLabel={`Sign in as ${d.role}`}>
              <d.icon size={20} color={colors.blue700} />
              <View>
                <Text style={styles.demoRole}>{d.role}</Text>
                <Text style={styles.demoDetail}>{d.detail}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.footer}>
        New to Park Mandu?{" "}
        <Link href="/register" style={{ color: colors.blue700, fontFamily: fonts.bold }}>
          Create an account
        </Link>
      </Text>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  segmented: { flexDirection: "row", backgroundColor: colors.slate100, borderRadius: 10, padding: 4 },
  segment: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10 },
  segmentActive: { backgroundColor: colors.white },
  segmentText: { fontFamily: fonts.bold, fontSize: 13, color: colors.slate600 },
  link: { alignSelf: "flex-end", color: colors.blue700, fontFamily: fonts.bold, fontSize: 13, marginTop: -6 },
  demo: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, overflow: "hidden", backgroundColor: colors.white, marginTop: 8 },
  demoTitle: { fontFamily: fonts.bold, fontSize: 11, color: colors.slate500, letterSpacing: 1, textTransform: "uppercase", padding: 12, paddingBottom: 4 },
  demoRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderTopWidth: 1, borderTopColor: colors.slate200 },
  demoRole: { fontFamily: fonts.bold, fontSize: 13, color: colors.slate950 },
  demoDetail: { fontFamily: fonts.body, fontSize: 12, color: colors.slate500 },
  footer: { textAlign: "center", fontFamily: fonts.body, fontSize: 13, color: colors.slate600, marginTop: 8 },
});
