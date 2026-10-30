import { Lock, Mail, Phone, User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, FormAlert, SubmitButton, TextField } from "@/components/forms";
import { registerAction } from "@/lib/actions/auth";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-3xl font-semibold md:text-[2.5rem] md:leading-[1.05]">Create your account</h1>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground">For residents and landowners. Traffic police and officials receive accounts from their department.</p>
      </header>
      <ActionForm action={registerAction}>
        <TextField name="full_name" label="Full name" icon={<User />} autoComplete="name" placeholder="As on your citizenship certificate" required />
        <TextField name="phone" label="Mobile number" type="tel" inputMode="tel" icon={<Phone />} autoComplete="tel" placeholder="98XXXXXXXX" required />
        <TextField name="email" label="Email (optional)" type="email" icon={<Mail />} autoComplete="email" placeholder="name@example.com" />
        <TextField
          name="password"
          label="Password"
          type="password"
          icon={<Lock />}
          autoComplete="new-password"
          hint="At least 8 characters with letters and numbers."
          required
        />
        <TextField name="confirm_password" label="Confirm password" type="password" icon={<Lock />} autoComplete="new-password" required />
        <FormAlert />
        <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
        <p className="text-center text-xs text-muted-foreground">
          By continuing you agree to the Park Mandu terms of service and privacy notice.
        </p>
      </ActionForm>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already registered? <Link href="/login" className="font-medium text-foreground underline underline-offset-4">Sign in</Link>
      </p>
    </>
  );
}
