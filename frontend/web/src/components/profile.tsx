import { Accessibility, BadgeCheck, CircleHelp, Lock, LogOut, Mail, ShieldCheck, User } from "lucide-react";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { changePasswordAction, logoutAction, updateProfileAction } from "@/lib/actions/auth";
import { formatDate } from "@/lib/format";
import type { User as Viewer } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Badge, KV, surface } from "./common";
import { ActionForm, FormAlert, SubmitButton, TextField } from "./forms";

export const menuRow =
  "flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left text-sm font-medium transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none [&_svg]:size-4 [&_svg]:shrink-0";

function RowLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-3">
      <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">{icon}</span>
      {children}
    </span>
  );
}

function SettingsCard({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <section className={cn(surface, "p-5")}>
      <header className="mb-5 flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">{icon}</span>
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-[0.8125rem] text-muted-foreground">{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

/** Shared profile page body for every role. */
export function ProfileView({ user, extra }: { user: Viewer; extra?: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <aside className="flex flex-col gap-3 lg:sticky lg:top-6">
        <section className={cn(surface, "p-5")}>
          <div className="flex items-center gap-4 lg:flex-col lg:items-start">
            <Avatar className="size-16">
              <AvatarFallback className="bg-brand/12 font-heading text-xl font-semibold text-brand-ink">{user.initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-semibold">{user.full_name}</h2>
              <p className="text-sm text-muted-foreground">
                {user.badge_number ? `${user.designation} · Badge ${user.badge_number}` : user.designation}
              </p>
              {user.unit && <p className="text-sm text-muted-foreground">{user.unit}</p>}
              <div className="mt-2">
                {user.is_verified ? (
                  <Badge tone="success">
                    <BadgeCheck className="size-3" /> Identity verified
                  </Badge>
                ) : (
                  <Badge tone="warning">Identity not verified yet</Badge>
                )}
              </div>
            </div>
          </div>
          <dl className="mt-5 border-t pt-2">
            <KV label="Phone" value={user.phone} />
            <KV label="Email" value={user.email} />
            <KV label="Member since" value={formatDate(user.created_at)} />
          </dl>
        </section>

        {extra}

        <form action={logoutAction}>
          <Button variant="outline" size="lg" className="w-full" type="submit">
            <LogOut /> Sign out
          </Button>
        </form>
        <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          Official Park Mandu service. Your data is protected under government digital-service standards.
        </p>
      </aside>

      <div className="flex flex-col gap-3">
        <SettingsCard icon={<User />} title="Personal information" description="How your name and contact details appear on applications.">
          <ActionForm action={updateProfileAction}>
            <div className="grid gap-5 md:grid-cols-2">
              <TextField name="full_name" label="Full name" defaultValue={user.full_name} icon={<User />} autoComplete="name" />
              <TextField name="email" label="Email" type="email" defaultValue={user.email} icon={<Mail />} autoComplete="email" />
            </div>
            <FormAlert />
            <div className="flex justify-end">
              <SubmitButton block={false} pendingLabel="Saving…">
                Save changes
              </SubmitButton>
            </div>
          </ActionForm>
        </SettingsCard>

        <SettingsCard
          icon={<Lock />}
          title="Security & sign-in"
          description={user.last_login_at ? `Last sign-in ${formatDate(user.last_login_at)}` : "Change the password you use to sign in."}
        >
          <ActionForm action={changePasswordAction}>
            <TextField name="current_password" label="Current password" type="password" autoComplete="current-password" />
            <div className="grid gap-5 md:grid-cols-2">
              <TextField name="new_password" label="New password" type="password" autoComplete="new-password" hint="At least 8 characters with letters and numbers." />
              <TextField name="confirm_password" label="Confirm new password" type="password" autoComplete="new-password" />
            </div>
            <FormAlert />
            <div className="flex justify-end">
              <SubmitButton block={false} pendingLabel="Updating…">
                Update password
              </SubmitButton>
            </div>
          </ActionForm>
        </SettingsCard>

        <section className={cn(surface, "overflow-hidden")}>
          <div className={cn(menuRow, "border-b hover:bg-transparent")}>
            <RowLabel icon={<Accessibility />}>Accessibility</RowLabel>
            <span className="text-right text-xs font-normal text-muted-foreground">Follows your device settings</span>
          </div>
          <div className={cn(menuRow, "hover:bg-transparent")}>
            <RowLabel icon={<CircleHelp />}>Help and support</RowLabel>
            <span className="max-w-[50%] text-right text-xs font-normal text-muted-foreground">Ward office or the Park Mandu help desk</span>
          </div>
        </section>
      </div>
    </div>
  );
}
