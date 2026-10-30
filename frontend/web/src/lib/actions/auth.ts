"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";

import { apiRequest } from "../api";
import { ACCESS_COOKIE, REFRESH_COOKIE, ROLE_HOME, writeSessionCookies } from "../session";
import type { AuthResponse, CodeSent, FormState, Role } from "../types";
import { failure, flash, safeNext, text } from "./utils";

const AREA_PREFIX: Record<Role, string[]> = {
  public: ["/home", "/explore", "/parking", "/my-parking", "/notifications", "/profile"],
  police: ["/police"],
  admin: ["/admin"],
};

async function startSession(response: AuthResponse, next: string | null): Promise<string> {
  const store = await cookies();
  if (response.tokens) writeSessionCookies(store, response.tokens);
  const role = response.user.role;
  return next && AREA_PREFIX[role].some((p) => next.startsWith(p)) ? next : ROLE_HOME[role];
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const identifier = text(form, "identifier");
  let destination: string;
  try {
    const response = await apiRequest<AuthResponse>("/auth/login", {
      method: "POST",
      json: { identifier, password: String(form.get("password") ?? "") },
    });
    destination = await startSession(response, safeNext(form.get("next")));
  } catch (error) {
    return failure(error, { identifier });
  }
  redirect(destination);
}

export async function demoLoginAction(form: FormData): Promise<void> {
  if (process.env.DEMO_LOGIN !== "true") return;
  let destination: string;
  try {
    const response = await apiRequest<AuthResponse>("/auth/login", {
      method: "POST",
      json: { identifier: text(form, "identifier"), password: "ParkMandu@2026" },
    });
    destination = await startSession(response, null);
  } catch (error) {
    // Demo buttons have no form state to return to, so report the failure on the sign-in page.
    console.error(error);
    redirect("/login?notice=demo_unavailable");
  }
  redirect(destination);
}

export async function requestOtpAction(_: FormState, form: FormData): Promise<FormState> {
  const phone = text(form, "phone");
  try {
    const sent = await apiRequest<CodeSent>("/auth/otp/request", { method: "POST", json: { phone } });
    return {
      ok: true,
      message: sent.dev_code ? `${sent.message} Development code: ${sent.dev_code}` : sent.message,
      values: { phone, step: "verify" },
    };
  } catch (error) {
    return failure(error, { phone });
  }
}

export async function verifyOtpAction(_: FormState, form: FormData): Promise<FormState> {
  const phone = text(form, "phone");
  let destination: string;
  try {
    const response = await apiRequest<AuthResponse>("/auth/otp/verify", {
      method: "POST",
      json: { phone, code: text(form, "code") },
    });
    destination = await startSession(response, safeNext(form.get("next")));
  } catch (error) {
    return { ...failure(error, { phone, step: "verify" }) };
  }
  redirect(destination);
}

export async function registerAction(_: FormState, form: FormData): Promise<FormState> {
  const values = { full_name: text(form, "full_name"), phone: text(form, "phone"), email: text(form, "email") };
  if (form.get("password") !== form.get("confirm_password")) {
    return { ok: false, message: "Passwords do not match.", fields: { confirm_password: "Passwords do not match." }, values };
  }
  let destination: string;
  try {
    const response = await apiRequest<AuthResponse>("/auth/register", {
      method: "POST",
      json: { ...values, email: values.email || null, password: String(form.get("password") ?? "") },
    });
    destination = await startSession(response, null);
  } catch (error) {
    return failure(error, values);
  }
  await flash("Welcome to Park Mandu! Your account is ready.");
  redirect(destination);
}

export async function forgotPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const identifier = text(form, "identifier");
  const params = new URLSearchParams({ identifier });
  try {
    const sent = await apiRequest<CodeSent>("/auth/password/forgot", { method: "POST", json: { identifier } });
    if (sent.dev_code) params.set("dev_code", sent.dev_code);
  } catch (error) {
    return failure(error, { identifier });
  }
  redirect(`/reset-password?${params}`);
}

export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const identifier = text(form, "identifier");
  if (form.get("new_password") !== form.get("confirm_password")) {
    return { ok: false, message: "Passwords do not match.", fields: { confirm_password: "Passwords do not match." }, values: { identifier } };
  }
  try {
    await apiRequest("/auth/password/reset", {
      method: "POST",
      json: { identifier, code: text(form, "code"), new_password: String(form.get("new_password") ?? "") },
    });
  } catch (error) {
    return failure(error, { identifier });
  }
  await flash("Password reset. Sign in with your new password.");
  redirect("/login");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  try {
    await apiRequest("/auth/logout", { method: "POST", json: { refresh_token: store.get(REFRESH_COOKIE)?.value } });
  } catch {
    // The session is cleared locally even if the API is unreachable.
  }
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
  await flash("You have been signed out.", "info");
  redirect("/login");
}

export async function updateProfileAction(_: FormState, form: FormData): Promise<FormState> {
  const values = { full_name: text(form, "full_name"), email: text(form, "email") };
  try {
    await apiRequest("/auth/me", { method: "PATCH", json: { full_name: values.full_name, email: values.email || null } });
  } catch (error) {
    return failure(error, values);
  }
  refresh();
  return { ok: true, message: "Your details have been saved.", values };
}

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  if (form.get("new_password") !== form.get("confirm_password")) {
    return { ok: false, fields: { confirm_password: "Passwords do not match." } };
  }
  try {
    await apiRequest("/auth/password/change", {
      method: "POST",
      json: { current_password: form.get("current_password"), new_password: form.get("new_password") },
    });
  } catch (error) {
    return failure(error);
  }
  return { ok: true, message: "Password updated. Other devices have been signed out." };
}
