import { router } from "expo-router";
import { KeyRound, Lock, User } from "lucide-react-native";
import { useState } from "react";
import { Alert } from "react-native";

import { AuthShell } from "@/components/auth-shell";
import { Button, Field, FormMessage } from "@/components/ui";
import { api, formErrors } from "@/lib/api";
import { colors } from "@/lib/theme";
import type { CodeSent } from "@/lib/types";

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
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

  return (
    <AuthShell title={sent ? "Choose a new password" : "Forgot your password?"} lead={sent ? "Enter the code we sent and your new password." : "We will send a reset code to the phone number on your account."}>
      <Field label="Phone number or email" icon={<User size={18} color={colors.slate500} />} value={identifier} onChangeText={setIdentifier} autoCapitalize="none" editable={!sent} />
      {sent && (
        <>
          <FormMessage ok message={sent} />
          <Field label="Reset code" icon={<KeyRound size={18} color={colors.slate500} />} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} error={error.fields.code} />
          <Field label="New password" icon={<Lock size={18} color={colors.slate500} />} value={password} onChangeText={setPassword} secureTextEntry hint="At least 8 characters with letters and numbers." error={error.fields.new_password} />
        </>
      )}
      <FormMessage message={error.message} />
      {sent ? (
        <Button
          title="Reset password"
          loading={busy}
          onPress={() =>
            run(async () => {
              await api("/auth/password/reset", { method: "POST", auth: false, json: { identifier, code, new_password: password } });
              Alert.alert("Password reset", "You can now sign in with your new password.");
              router.replace("/login");
            })
          }
        />
      ) : (
        <Button
          title="Send reset code"
          loading={busy}
          onPress={() =>
            run(async () => {
              const res = await api<CodeSent>("/auth/password/forgot", { method: "POST", auth: false, json: { identifier } });
              setSent(res.dev_code ? `${res.message} Development code: ${res.dev_code}` : res.message);
            })
          }
        />
      )}
      <Button title="Back to sign in" variant="ghost" onPress={() => router.replace("/login")} />
    </AuthShell>
  );
}
