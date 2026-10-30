import { BadgeCheck, LogOut, ShieldCheck } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Alert, View } from "react-native";

import { api, formErrors } from "@/lib/api";
import { useAuth, useViewer } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { colors, usePalette } from "@/lib/theme";

import { Badge, Button, Card, Field, FormMessage, KV, Row, SectionTitle, Txt } from "./ui";

/** Profile screen body shared by every role. */
export function ProfileView({ extra }: { extra?: ReactNode }) {
  const user = useViewer();
  const { signOut, refreshUser } = useAuth();
  const p = usePalette();
  const [name, setName] = useState(user.full_name);
  const [email, setEmail] = useState(user.email ?? "");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [busy, setBusy] = useState<"profile" | "password" | null>(null);
  const [msg, setMsg] = useState<{ profile?: string; password?: string; ok?: boolean; fields: Record<string, string> }>({ fields: {} });

  const saveProfile = async () => {
    setBusy("profile");
    try {
      await api("/auth/me", { method: "PATCH", json: { full_name: name, email: email || null } });
      await refreshUser();
      setMsg({ profile: "Your details have been saved.", ok: true, fields: {} });
    } catch (e) {
      const err = formErrors(e);
      setMsg({ profile: err.message ?? undefined, fields: err.fields });
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async () => {
    setBusy("password");
    try {
      await api("/auth/password/change", { method: "POST", json: { current_password: pw.current, new_password: pw.next } });
      setPw({ current: "", next: "" });
      setMsg({ password: "Password updated. Other devices were signed out.", ok: true, fields: {} });
    } catch (e) {
      const err = formErrors(e);
      setMsg({ password: err.message ?? undefined, fields: err.fields });
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <View style={{ alignItems: "center", gap: 6, marginBottom: 18 }}>
        <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: p.dark ? "rgba(82,148,246,0.16)" : colors.blue100, alignItems: "center", justifyContent: "center" }}>
          <Txt variant="h1" color={p.dark ? "#91c0ff" : colors.blue700}>
            {user.initials}
          </Txt>
        </View>
        <Txt variant="h2">{user.full_name}</Txt>
        <Txt variant="muted">{user.badge_number ? `${user.designation} · Badge ${user.badge_number}` : user.designation}</Txt>
        {user.unit && <Txt variant="small">{user.unit}</Txt>}
        {user.is_verified ? (
          <Badge tone="success">Identity verified</Badge>
        ) : (
          <Badge tone="warning">Identity not verified yet</Badge>
        )}
      </View>

      {extra}

      <SectionTitle title="Personal information" />
      <Card style={{ gap: 16 }}>
        <Field label="Full name" value={name} onChangeText={setName} error={msg.fields.full_name} />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" error={msg.fields.email} />
        <KV label="Phone" value={user.phone} />
        <KV label="Member since" value={formatDate(user.created_at)} />
        <FormMessage message={msg.profile} ok={msg.ok} />
        <Button title="Save changes" onPress={saveProfile} loading={busy === "profile"} />
      </Card>

      <SectionTitle title="Security & sign-in" />
      <Card style={{ gap: 16 }}>
        <Field label="Current password" value={pw.current} onChangeText={(v) => setPw((s) => ({ ...s, current: v }))} secureTextEntry error={msg.fields.current_password} />
        <Field label="New password" value={pw.next} onChangeText={(v) => setPw((s) => ({ ...s, next: v }))} secureTextEntry hint="At least 8 characters with letters and numbers." error={msg.fields.new_password} />
        <FormMessage message={msg.password} ok={msg.ok} />
        <Button title="Update password" variant="secondary" onPress={changePassword} loading={busy === "password"} disabled={!pw.current || !pw.next} />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Row style={{ alignItems: "flex-start" }}>
          <ShieldCheck size={20} color={colors.blue600} />
          <View style={{ flex: 1 }}>
            <Txt variant="label">Official Park Mandu service</Txt>
            <Txt variant="small">Your data is protected under government digital-service standards.</Txt>
          </View>
          <BadgeCheck size={18} color={colors.green500} />
        </Row>
      </Card>

      <Button
        title="Sign out"
        variant="secondary"
        icon={<LogOut size={18} color={p.dark ? "white" : colors.blue700} />}
        style={{ marginTop: 12 }}
        onPress={() =>
          Alert.alert("Sign out?", "You will need to sign in again to use Park Mandu.", [
            { text: "Cancel", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: () => void signOut() },
          ])
        }
      />
    </View>
  );
}
