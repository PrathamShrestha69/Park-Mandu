import { ChartColumn, ChevronRight, Lock, Siren, SquareParking, User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { OtpLogin } from "@/components/auth-forms";
import { Callout, surface } from "@/components/common";
import { ActionForm, FormAlert, SubmitButton, TextField } from "@/components/forms";
import { FieldSeparator } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { demoLoginAction, loginAction } from "@/lib/actions/auth";
import { param } from "@/lib/api-query";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sign in" };

const DEMO = [
  { identifier: "sita.sharma@example.com", role: "Public user / Landowner", detail: "Sita Sharma · find & register parking", icon: <SquareParking /> },
  { identifier: "TP-2841", role: "Traffic police", detail: "Inspector Rajendra Karki · monitor roads", icon: <Siren /> },
  { identifier: "nabin.shrestha@parkmandu.test", role: "Government administrator", detail: "Nabin Shrestha · review & manage", icon: <ChartColumn /> },
];

const TAB = cn(
  "flex h-9 items-center justify-center rounded-md text-sm font-medium text-muted-foreground transition-colors",
  "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
  "aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-xs aria-selected:ring-1 aria-selected:ring-foreground/[0.08]",
);

async function LoginContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const mode = param(params, "mode") === "otp" ? "otp" : "password";
  const next = param(params, "next");
  const expired = param(params, "expired");
  const demoFailed = param(params, "notice") === "demo_unavailable";
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";

  return (
    <div className="flex flex-col gap-6">
      {expired && (
        <Callout tone="warning" title="Your session has ended">
          For your security, please sign in again.
        </Callout>
      )}
      {demoFailed && (
        <Callout tone="danger" title="Demo sign-in failed">
          The Park Mandu API could not be reached. Start the backend (docker compose up in /backend) and try again.
        </Callout>
      )}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Sign-in method">
        <Link href={`/login?mode=password${nextQuery}`} aria-selected={mode === "password"} role="tab" className={TAB}>
          Password
        </Link>
        <Link href={`/login?mode=otp${nextQuery}`} aria-selected={mode === "otp"} role="tab" className={TAB}>
          One-time code
        </Link>
      </div>

      {mode === "password" ? (
        <ActionForm action={loginAction}>
          <input type="hidden" name="next" value={next ?? ""} />
          <TextField
            name="identifier"
            label="Phone, email or badge number"
            icon={<User />}
            autoComplete="username"
            placeholder="98XXXXXXXX or name@example.com"
            required
          />
          <div className="flex flex-col gap-2">
            <TextField name="password" type="password" label="Password" icon={<Lock />} autoComplete="current-password" required />
            <Link href="/forgot-password" className="self-end text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Forgot password?
            </Link>
          </div>
          <FormAlert />
          <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
        </ActionForm>
      ) : (
        <OtpLogin next={next} />
      )}

      {process.env.DEMO_LOGIN === "true" && (
        <>
          <FieldSeparator className="my-1">Demo accounts</FieldSeparator>
          <div className={cn(surface, "overflow-hidden")}>
            {DEMO.map((d) => (
              <form key={d.identifier} action={demoLoginAction} className="border-b last:border-b-0">
                <input type="hidden" name="identifier" value={d.identifier} />
                <button
                  type="submit"
                  className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">{d.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{d.role}</span>
                    <small className="block truncate text-xs text-muted-foreground">{d.detail}</small>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              </form>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-3xl font-semibold md:text-[2.5rem] md:leading-[1.05]">Welcome back</h1>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground">Sign in to parking and traffic services. Your role is detected automatically.</p>
      </header>
      <Suspense fallback={<Skeleton className="h-80 rounded-xl" />}>
        <LoginContent searchParams={props.searchParams} />
      </Suspense>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        New to Park Mandu?{" "}
        <Link href="/register" className="font-medium text-foreground underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </>
  );
}
