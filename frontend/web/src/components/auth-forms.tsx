"use client";

import { KeyRound, Phone } from "lucide-react";
import { useActionState } from "react";

import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { requestOtpAction, verifyOtpAction } from "@/lib/actions/auth";

import { ActionForm, FormAlert, FormMessage, SubmitButton, TextField } from "./forms";

/** Two-step sign-in with a one-time SMS code. */
export function OtpLogin({ next }: { next?: string }) {
  const [sent, requestAction] = useActionState(requestOtpAction, {});
  const phone = sent.values?.phone;

  if (sent.ok && phone) {
    return (
      <ActionForm action={verifyOtpAction}>
        <FormMessage ok>{sent.message}</FormMessage>
        <input type="hidden" name="phone" value={phone} />
        <input type="hidden" name="next" value={next ?? ""} />
        <TextField
          name="code"
          label="6-digit code"
          icon={<KeyRound />}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="••••••"
          required
        />
        <FormAlert />
        <SubmitButton pendingLabel="Verifying…">Verify and sign in</SubmitButton>
      </ActionForm>
    );
  }

  return (
    <form action={requestAction} className="flex flex-col gap-5" noValidate>
      <Field data-invalid={sent.fields?.phone ? true : undefined} className="gap-2">
        <FieldLabel htmlFor="otp-phone">Registered phone number</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="otp-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98XXXXXXXX"
            defaultValue={phone}
            required
            aria-invalid={sent.fields?.phone ? true : undefined}
          />
          <InputGroupAddon className="pl-3">
            <Phone />
          </InputGroupAddon>
        </InputGroup>
        {sent.fields?.phone && <FieldError>{sent.fields.phone}</FieldError>}
      </Field>
      {sent.message && !sent.ok && <FormMessage>{sent.message}</FormMessage>}
      <SubmitButton pendingLabel="Sending code…">Send one-time code</SubmitButton>
    </form>
  );
}
