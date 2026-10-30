import { BadgeCheck, Building2, Lock, Mail, Phone, User } from "lucide-react";
import type { Metadata } from "next";

import { ActionForm, FormAlert, SelectField, SubmitButton, TextField } from "@/components/forms";
import { Callout, PageHead, surface } from "@/components/common";
import { createStaffAction } from "@/lib/actions/operations";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Add staff account" };

export default function NewStaffPage() {
  return (
    <div className="w-full max-w-3xl">
      <PageHead title="Add staff account" subtitle="Traffic police officers and government administrators" back="/admin/users" />
      <div className={cn(surface, "p-5")}>
        <ActionForm action={createStaffAction}>
          <SelectField
            name="role"
            label="Role"
            defaultValue="police"
            options={[
              { value: "police", label: "Traffic police officer" },
              { value: "admin", label: "Government administrator" },
            ]}
          />
          <TextField name="full_name" label="Full name" icon={<User />} required />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField name="designation" label="Designation" placeholder="e.g. Sub-Inspector" />
            <TextField name="badge_number" label="Badge number (police)" icon={<BadgeCheck />} placeholder="TP-0000" />
          </div>
          <TextField name="unit" label="Unit / department" icon={<Building2 />} placeholder="Metropolitan Traffic Police Division · Central" />
          <TextField name="email" label="Official email" type="email" icon={<Mail />} required />
          <TextField name="phone" label="Mobile number" type="tel" icon={<Phone />} placeholder="98XXXXXXXX" required />
          <TextField name="password" label="Temporary password" type="password" icon={<Lock />} autoComplete="new-password" hint="Share it securely; the officer should change it after first sign-in." required />
          <Callout>Staff accounts are verified automatically and every creation is recorded in the audit log.</Callout>
          <FormAlert />
          <SubmitButton pendingLabel="Creating…">Create account</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}
