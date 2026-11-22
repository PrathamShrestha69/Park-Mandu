import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiError } from "../api";
import { MESSAGES, SESSION_LOST_CODES } from "../errors";
import { FLASH_COOKIE } from "../session";
import type { FormState } from "../types";

export function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

/** Converts an API failure into form state (field errors + message). Session loss redirects to sign-in. */
export function failure(error: unknown, values: Record<string, string> = {}): FormState {
  if (error instanceof ApiError) {
    if (error.status === 401 && SESSION_LOST_CODES.includes(error.code)) {
      redirect("/login?expired=1");
    }
    const fields = { ...error.fields };
    const message = fields.non_field ?? error.message;
    delete fields.non_field;
    return { ok: false, message, fields, values };
  }
  // Never show a stack trace or a framework error; log it for developers instead.
  console.error("[action] unexpected failure", error);
  return { ok: false, message: MESSAGES.server, values };
}

/** One-shot toast message picked up by the client <FlashToaster />. */
export async function flash(message: string, tone: "success" | "info" | "error" = "success"): Promise<void> {
  const store = await cookies();
  store.set(FLASH_COOKIE, JSON.stringify({ message, tone }), { path: "/", maxAge: 20, sameSite: "lax" });
}

/** Only allow same-site relative redirects after sign-in. */
export function safeNext(value: FormDataEntryValue | null): string | null {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : null;
}
