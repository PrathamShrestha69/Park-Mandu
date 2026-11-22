"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { apiRequest } from "../api";
import type { ApplicationDetail, FormState, IncidentDetail } from "../types";
import { failure, flash, text } from "./utils";

// --------------------------------------------------------------------------- police

export async function setDutyAction(form: FormData): Promise<void> {
  const onDuty = form.get("on_duty") === "true";
  try {
    await apiRequest("/police/duty", { method: "PATCH", json: { on_duty: onDuty } });
    await flash(onDuty ? "You are now on duty." : "You are now off duty.", "info");
  } catch (error) {
    await flash(failure(error).message ?? "Could not update duty status.", "error");
  }
  refresh();
}

export async function handleAlertAction(form: FormData): Promise<void> {
  let incidentId: string;
  try {
    incidentId = (await apiRequest<IncidentDetail>(`/alerts/${text(form, "alert_id")}/handle`, { method: "POST" })).id;
  } catch (error) {
    await flash(failure(error).message ?? "Could not take this alert.", "error");
    refresh();
    return;
  }
  await flash("Incident opened and assigned to you.");
  redirect(`/police/incidents/${incidentId}`);
}

export async function dismissAlertAction(_: FormState, form: FormData): Promise<FormState> {
  const reason = text(form, "reason");
  try {
    await apiRequest(`/alerts/${text(form, "alert_id")}/dismiss`, { method: "POST", json: { reason } });
  } catch (error) {
    return failure(error, { reason });
  }
  await flash("Alert dismissed.", "info");
  redirect("/police/alerts");
}

export async function addNoteAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    await apiRequest(`/incidents/${text(form, "incident_id")}/notes`, { method: "POST", json: { body: text(form, "body") } });
  } catch (error) {
    return failure(error, { body: text(form, "body") });
  }
  refresh();
  return { ok: true, message: "Note added." };
}

export async function resolveIncidentAction(_: FormState, form: FormData): Promise<FormState> {
  const resolution = text(form, "resolution") || "Vehicle moved and road cleared.";
  try {
    await apiRequest(`/incidents/${text(form, "incident_id")}/resolve`, { method: "POST", json: { resolution } });
  } catch (error) {
    return failure(error, { resolution });
  }
  await flash("Incident marked as resolved.");
  refresh();
  return { ok: true };
}

// --------------------------------------------------------------------------- admin

export async function startReviewAction(form: FormData): Promise<void> {
  try {
    await apiRequest(`/admin/applications/${text(form, "application_id")}/start-review`, { method: "POST" });
    await flash("Application moved to review. The applicant has been notified.", "info");
  } catch (error) {
    await flash(failure(error).message ?? "Could not start the review.", "error");
  }
  refresh();
}

const DECISION_MESSAGES: Record<string, string> = {
  approve: "Application approved and published to the public map.",
  reject: "Application rejected. The applicant has been notified.",
  request_changes: "Changes requested from the applicant.",
  request_documents: "Additional documents requested from the applicant.",
};

export async function decideAction(_: FormState, form: FormData): Promise<FormState> {
  const decision = text(form, "decision");
  const feedback = text(form, "feedback");
  try {
    await apiRequest<ApplicationDetail>(`/admin/applications/${text(form, "application_id")}/decision`, {
      method: "POST",
      json: { decision, feedback: feedback || null },
    });
  } catch (error) {
    return failure(error, { feedback });
  }
  await flash(DECISION_MESSAGES[decision] ?? "Decision recorded.");
  refresh();
  return { ok: true };
}

export async function createStaffAction(_: FormState, form: FormData): Promise<FormState> {
  const values = Object.fromEntries(
    ["full_name", "email", "phone", "role", "designation", "badge_number", "unit"].map((k) => [k, text(form, k)]),
  );
  try {
    await apiRequest("/admin/users", {
      method: "POST",
      json: {
        ...values,
        designation: values.designation || null,
        badge_number: values.badge_number || null,
        unit: values.unit || null,
        password: String(form.get("password") ?? ""),
      },
    });
  } catch (error) {
    return failure(error, values);
  }
  await flash(`${values.full_name} can now sign in.`);
  redirect("/admin/users");
}

const ISSUE_MESSAGES: Record<string, string> = {
  open: "Report reopened.",
  reviewed: "Report marked as reviewed. The reporter has been notified.",
  closed: "Report closed. The reporter has been notified.",
};

export async function setIssueStatusAction(form: FormData): Promise<void> {
  const status = text(form, "status");
  try {
    await apiRequest(`/admin/issues/${text(form, "issue_id")}`, { method: "PATCH", json: { status } });
    await flash(ISSUE_MESSAGES[status] ?? "Report updated.", "info");
  } catch (error) {
    await flash(failure(error).message ?? "Could not update the report.", "error");
  }
  refresh();
}

export async function setUserStatusAction(form: FormData): Promise<void> {
  const status = text(form, "status");
  try {
    await apiRequest(`/admin/users/${text(form, "user_id")}`, { method: "PATCH", json: { status } });
    await flash(status === "suspended" ? "Account suspended and signed out everywhere." : "Account reactivated.", "info");
  } catch (error) {
    await flash(failure(error).message ?? "Could not update the account.", "error");
  }
  refresh();
}

// --------------------------------------------------------------------------- dispatch

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** The officer's device reports its position so incidents go to the nearest available officer. */
export async function updateLocationAction(latitude: number, longitude: number): Promise<ActionResult> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false, message: "Invalid position." };
  try {
    await apiRequest("/police/location", { method: "PUT", json: { latitude, longitude } });
    return { ok: true, message: "" };
  } catch (error) {
    return { ok: false, message: failure(error).message ?? "" };
  }
}

export async function respondToDispatchAction(alertId: string, accept: boolean): Promise<ActionResult> {
  try {
    const result = await apiRequest<{ message: string }>(`/alerts/${alertId}/${accept ? "acknowledge" : "decline"}`, {
      method: "POST",
      json: accept ? undefined : {},
    });
    refresh();
    return { ok: true, message: result.message };
  } catch (error) {
    return { ok: false, message: failure(error).message ?? "" };
  }
}

export async function dispatchResponseFormAction(form: FormData): Promise<void> {
  const accept = form.get("response") === "accept";
  const result = await respondToDispatchAction(text(form, "alert_id"), accept);
  await flash(result.message, result.ok ? (accept ? "success" : "info") : "error");
  refresh();
}

// --------------------------------------------------------------------------- suggestions

export async function submitSuggestionAction(_: FormState, form: FormData): Promise<FormState> {
  const values = { category: text(form, "category") || "other", message: text(form, "message") };
  if (values.message.length < 10) {
    return {
      ok: false,
      fields: { message: "Please write at least 10 characters so we can understand your suggestion." },
      values,
    };
  }
  try {
    const result = await apiRequest<{ message: string }>("/suggestions", {
      method: "POST",
      json: { ...values, website: text(form, "website") || null },
    });
    refresh();
    // Clearing `values` empties the form for the next suggestion.
    return { ok: true, message: result.message, values: { category: values.category, message: "" } };
  } catch (error) {
    return failure(error, values);
  }
}

export async function updateSuggestionAction(form: FormData): Promise<void> {
  const status = text(form, "status");
  const note = form.get("admin_note");
  try {
    await apiRequest(`/admin/suggestions/${text(form, "suggestion_id")}`, {
      method: "PATCH",
      json: { ...(status ? { status } : {}), ...(note !== null ? { admin_note: String(note) } : {}) },
    });
    await flash("Suggestion updated.");
  } catch (error) {
    await flash(failure(error).message ?? "Could not update the suggestion.", "error");
  }
  refresh();
}

export async function deleteSuggestionAction(form: FormData): Promise<void> {
  try {
    await apiRequest(`/admin/suggestions/${text(form, "suggestion_id")}`, { method: "DELETE" });
    await flash("Suggestion deleted.", "info");
  } catch (error) {
    await flash(failure(error).message ?? "Could not delete the suggestion.", "error");
  }
  refresh();
}
