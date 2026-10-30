"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { apiRequest } from "../api";
import type { ApplicationDetail, FormState } from "../types";
import { failure, flash, optional, text } from "./utils";

const editPath = (id: string, step: string) => `/my-parking/${id}/edit/${step}`;

export async function createDraftAction(): Promise<void> {
  let id: string;
  try {
    id = (await apiRequest<ApplicationDetail>("/applications", { method: "POST" })).id;
  } catch (error) {
    const state = failure(error);
    await flash(state.message ?? "Could not start a new application.", "error");
    redirect("/my-parking");
  }
  redirect(editPath(id, "location"));
}

export async function saveLocationAction(_: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "application_id");
  const values = {
    latitude: text(form, "latitude"),
    longitude: text(form, "longitude"),
    address: text(form, "address"),
    area: text(form, "area"),
  };
  if (!values.latitude || !values.longitude) {
    return { ok: false, message: "Tap the map or use your current location to place the pin.", values };
  }
  try {
    await apiRequest(`/applications/${id}/location`, {
      method: "PUT",
      json: { ...values, latitude: Number(values.latitude), longitude: Number(values.longitude), area: values.area || null },
    });
  } catch (error) {
    return failure(error, values);
  }
  redirect(editPath(id, "property"));
}

export async function savePropertyAction(_: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "application_id");
  const values = Object.fromEntries(
    ["property_name", "land_size_sqm", "capacity", "parking_type", "opens_at", "closes_at", "available_days", "pricing_mode", "price_per_hour"].map(
      (key) => [key, text(form, key)],
    ),
  );
  try {
    await apiRequest(`/applications/${id}/property`, {
      method: "PUT",
      json: {
        ...values,
        land_size_sqm: values.land_size_sqm ? Number(values.land_size_sqm) : null,
        capacity: values.capacity ? Number(values.capacity) : null,
        price_per_hour: values.pricing_mode === "hourly" ? values.price_per_hour || null : null,
      },
    });
  } catch (error) {
    return failure(error, values);
  }
  redirect(editPath(id, "owner"));
}

export async function saveOwnerAction(_: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "application_id");
  const values = {
    owner_name: text(form, "owner_name"),
    owner_phone: text(form, "owner_phone"),
    government_id: text(form, "government_id"),
    ownership_document_number: text(form, "ownership_document_number"),
  };
  try {
    await apiRequest(`/applications/${id}/owner`, {
      method: "PUT",
      json: { ...values, owner_confirmed: form.get("owner_confirmed") === "on" },
    });
  } catch (error) {
    return failure(error, { ...values, government_id: "" });
  }
  redirect(editPath(id, "documents"));
}

export async function uploadDocumentAction(_: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "application_id");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a file to upload." };
  }
  const payload = new FormData();
  payload.set("kind", text(form, "kind"));
  payload.set("file", file, file.name);
  try {
    await apiRequest(`/applications/${id}/documents`, { method: "POST", form: payload });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { ok: true, message: `${file.name} uploaded.` };
}

export async function deleteDocumentAction(form: FormData): Promise<void> {
  try {
    await apiRequest(`/applications/${text(form, "application_id")}/documents/${text(form, "document_id")}`, { method: "DELETE" });
    await flash("Document removed.", "info");
  } catch (error) {
    await flash(failure(error).message ?? "Could not remove the document.", "error");
  }
  refresh();
}

export async function submitApplicationAction(_: FormState, form: FormData): Promise<FormState> {
  const id = text(form, "application_id");
  if (form.get("declaration") !== "on") {
    return { ok: false, fields: { declaration: "Please confirm the declaration to submit." } };
  }
  try {
    await apiRequest(`/applications/${id}/submit`, { method: "POST", json: { declaration_accepted: true } });
  } catch (error) {
    return failure(error);
  }
  redirect(`/my-parking/${id}/submitted`);
}

export async function deleteDraftAction(form: FormData): Promise<void> {
  try {
    await apiRequest(`/applications/${text(form, "application_id")}`, { method: "DELETE" });
    await flash("Draft deleted.", "info");
  } catch (error) {
    await flash(failure(error).message ?? "Could not delete the draft.", "error");
  }
  redirect("/my-parking");
}

export async function reportIssueAction(_: FormState, form: FormData): Promise<FormState> {
  const parkingId = text(form, "parking_id");
  const values = { category: text(form, "category"), description: text(form, "description") };
  try {
    await apiRequest(`/parkings/${parkingId}/reports`, { method: "POST", json: values });
  } catch (error) {
    return failure(error, values);
  }
  await flash("Thank you — your report has been sent to the parking authority.");
  redirect(`/parking/${parkingId}`);
}

export async function openNotificationAction(form: FormData): Promise<void> {
  const id = text(form, "notification_id");
  const href = optional(form, "href");
  try {
    await apiRequest(`/notifications/${id}/read`, { method: "POST" });
  } catch {
    // Opening still works if marking as read fails.
  }
  if (href?.startsWith("/")) redirect(href);
  refresh();
}

export async function markAllReadAction(): Promise<void> {
  try {
    await apiRequest("/notifications/read-all", { method: "POST" });
    await flash("All notifications marked as read.", "info");
  } catch (error) {
    await flash(failure(error).message ?? "Could not update notifications.", "error");
  }
  refresh();
}
