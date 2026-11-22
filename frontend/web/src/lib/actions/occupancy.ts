"use server";

import { refresh } from "next/cache";

import { apiRequest } from "../api";
import type { FormState } from "../types";
import { failure, flash, text } from "./utils";

// --------------------------------------------------------------------------- owner occupancy monitoring

export async function connectCameraAction(_: FormState, form: FormData): Promise<FormState> {
  const values = { name: text(form, "name"), source_url: text(form, "source_url") };
  try {
    await apiRequest(`/my-parkings/${text(form, "parking_id")}/camera`, { method: "PUT", json: values });
  } catch (error) {
    return failure(error, values);
  }
  refresh();
  return { ok: true, message: "Camera saved. Start the AI detector for it to begin counting." };
}

export async function disconnectCameraAction(form: FormData): Promise<void> {
  try {
    await apiRequest(`/my-parkings/${text(form, "parking_id")}/camera`, { method: "DELETE" });
    await flash("Camera disconnected.", "info");
  } catch (error) {
    await flash(failure(error).message ?? "Could not disconnect the camera.", "error");
  }
  refresh();
}

export async function correctOccupancyAction(_: FormState, form: FormData): Promise<FormState> {
  const occupied = text(form, "occupied_spaces");
  try {
    await apiRequest(`/my-parkings/${text(form, "parking_id")}/occupancy`, {
      method: "PUT",
      json: { occupied_spaces: occupied === "" ? null : Number(occupied) },
    });
  } catch (error) {
    return failure(error, { occupied_spaces: occupied });
  }
  refresh();
  return { ok: true, message: "Occupancy updated. Public listings show the new figure now." };
}
