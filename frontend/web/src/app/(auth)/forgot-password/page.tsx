import { User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, FormAlert, SubmitButton, TextField } from "@/components/forms";
import { forgotPasswordAction } from "@/lib/actions/auth";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-3xl font-semibold md:text-[2.5rem] md:leading-[1.05]">Forgot your password?</h1>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground">Enter the phone number or email on your account. We will send a reset code to your registered phone.</p>
      </header>
      <ActionForm action={forgotPasswordAction}>
        <TextField name="identifier" label="Phone number or email" icon={<User />} autoComplete="username" required />
        <FormAlert />
        <SubmitButton pendingLabel="Sending…">Send reset code</SubmitButton>
      </ActionForm>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Remembered it? <Link href="/login" className="font-medium text-foreground underline underline-offset-4">Back to sign in</Link>
      </p>
    </>
  );
}
