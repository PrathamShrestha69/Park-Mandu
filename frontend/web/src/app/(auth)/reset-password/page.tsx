import { KeyRound, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActionForm, FormAlert, SubmitButton, TextField } from "@/components/forms";
import { Callout } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import { resetPasswordAction } from "@/lib/actions/auth";
import { param } from "@/lib/api-query";

export const metadata: Metadata = { title: "Choose a new password" };

async function ResetForm({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const identifier = param(params, "identifier") ?? "";
  const devCode = param(params, "dev_code");
  return (
    <ActionForm action={resetPasswordAction}>
      <Callout title="Check your phone">
        If an account matches <strong className="font-semibold">{identifier}</strong>, a 6-digit code is on its way.
        {devCode && ` Development code: ${devCode}`}
      </Callout>
      <input type="hidden" name="identifier" value={identifier} />
      <TextField name="code" label="Reset code" icon={<KeyRound />} inputMode="numeric" autoComplete="one-time-code" required />
      <TextField name="new_password" label="New password" type="password" icon={<Lock />} autoComplete="new-password" hint="At least 8 characters with letters and numbers." required />
      <TextField name="confirm_password" label="Confirm new password" type="password" icon={<Lock />} autoComplete="new-password" required />
      <FormAlert />
      <SubmitButton pendingLabel="Saving…">Reset password</SubmitButton>
    </ActionForm>
  );
}

export default function ResetPasswordPage(props: PageProps<"/reset-password">) {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-3xl font-semibold md:text-[2.5rem] md:leading-[1.05]">Choose a new password</h1>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground">For your security, you will be signed out of other devices.</p>
      </header>
      <Suspense fallback={<Skeleton className="h-80 rounded-xl" />}>
        <ResetForm searchParams={props.searchParams} />
      </Suspense>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        <Link href="/forgot-password" className="font-medium text-foreground underline underline-offset-4">Send a new code</Link>
      </p>
    </>
  );
}
