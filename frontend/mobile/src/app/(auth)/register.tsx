import { Link } from "expo-router";
import { Lock, Mail, Phone, User } from "lucide-react-native";
import { useState } from "react";
import { Text } from "react-native";

import { AuthShell } from "@/components/auth-shell";
import { Button, Field, FormMessage } from "@/components/ui";
import { api, formErrors } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, fonts } from "@/lib/theme";
import type { AuthResponse } from "@/lib/types";

export default function Register() {
  const { signIn } = useAuth();
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string | null; fields: Record<string, string> }>({ message: null, fields: {} });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (form.password !== form.confirm) return setError({ message: null, fields: { confirm: "Passwords do not match." } });
    setBusy(true);
    setError({ message: null, fields: {} });
    try {
      const response = await api<AuthResponse>("/auth/register", {
        method: "POST",
        auth: false,
        json: { full_name: form.full_name, phone: form.phone, email: form.email || null, password: form.password },
      });
      await signIn(response);
    } catch (e) {
      setError(formErrors(e));
    } finally {
      setBusy(false);
    }
  };

  const icon = (Icon: typeof User) => <Icon size={18} color={colors.slate500} />;
  return (
    <AuthShell title="Create your account" lead="For residents and landowners. Police and officials receive accounts from their department.">
      <Field label="Full name" icon={icon(User)} value={form.full_name} onChangeText={set("full_name")} autoComplete="name" error={error.fields.full_name} />
      <Field label="Mobile number" icon={icon(Phone)} value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" placeholder="98XXXXXXXX" error={error.fields.phone} />
      <Field label="Email (optional)" icon={icon(Mail)} value={form.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" error={error.fields.email} />
      <Field label="Password" icon={icon(Lock)} value={form.password} onChangeText={set("password")} secureTextEntry hint="At least 8 characters with letters and numbers." error={error.fields.password} />
      <Field label="Confirm password" icon={icon(Lock)} value={form.confirm} onChangeText={set("confirm")} secureTextEntry error={error.fields.confirm} />
      <FormMessage message={error.message} />
      <Button title="Create account" loading={busy} onPress={submit} />
      <Text style={{ textAlign: "center", fontFamily: fonts.body, fontSize: 13, color: colors.slate600 }}>
        Already registered?{" "}
        <Link href="/login" style={{ color: colors.blue700, fontFamily: fonts.bold }}>
          Sign in
        </Link>
      </Text>
    </AuthShell>
  );
}
