"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { ApiError, apiRequest } from "../api";
import type { BookingDetail, FormState } from "../types";
import { failure, flash, text } from "./utils";

/** Form state for checkout: on success the browser is sent to eSewa / Khalti. */
export interface CheckoutState extends FormState {
  checkoutUrl?: string;
  bookingId?: string;
}

interface CheckoutOut {
  booking_id: string;
  checkout_url: string;
}

/** Where eSewa / Khalti send the driver back: this app's booking page (the API checks it is allowed). */
async function returnUrl(bookingId: string): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}/bookings/${bookingId}`;
}

async function startPayment(bookingId: string, provider: string): Promise<CheckoutOut> {
  return apiRequest<CheckoutOut>(`/bookings/${bookingId}/payments`, {
    method: "POST",
    json: { provider, return_url: await returnUrl(bookingId) },
  });
}

/** Book and pay: holds a space for the chosen hours, then starts the chosen payment method. */
export async function checkoutAction(_: CheckoutState, form: FormData): Promise<CheckoutState> {
  const values = { hours: text(form, "hours"), provider: text(form, "provider"), vehicle_plate: text(form, "vehicle_plate") };
  if (!values.provider) return { ok: false, message: "Choose eSewa or Khalti.", fields: { provider: "Choose a payment method" }, values };
  let bookingId: string;
  try {
    const booking = await apiRequest<BookingDetail>("/bookings", {
      method: "POST",
      json: { parking_id: text(form, "parking_id"), hours: Number(values.hours), vehicle_plate: values.vehicle_plate || null },
    });
    bookingId = booking.id;
  } catch (error) {
    // A space is already held for this driver here (double click, second tab): pay for that one.
    if (error instanceof ApiError && error.code === "booking_pending" && error.fields.booking_id) {
      bookingId = error.fields.booking_id;
    } else {
      return failure(error, values);
    }
  }
  try {
    const checkout = await startPayment(bookingId, values.provider);
    return { ok: true, checkoutUrl: checkout.checkout_url, bookingId };
  } catch (error) {
    return { ...failure(error, values), bookingId };
  }
}

/** Pay again for a held booking, or pay for a pending extension. */
export async function payAction(_: CheckoutState, form: FormData): Promise<CheckoutState> {
  const bookingId = text(form, "booking_id");
  try {
    const checkout = await startPayment(bookingId, text(form, "provider"));
    return { ok: true, checkoutUrl: checkout.checkout_url, bookingId };
  } catch (error) {
    return failure(error);
  }
}

export async function extendAction(_: CheckoutState, form: FormData): Promise<CheckoutState> {
  const bookingId = text(form, "booking_id");
  const values = { hours: text(form, "hours"), provider: text(form, "provider") };
  try {
    const detail = await apiRequest<BookingDetail>(`/bookings/${bookingId}/extend`, { method: "POST", json: { hours: Number(values.hours) } });
    const extension = detail.extensions.find((e) => e.status === "pending_payment");
    if (!extension) return { ok: false, message: "The extension could not be created.", values };
    const checkout = await apiRequest<CheckoutOut>(`/bookings/${extension.id}/payments`, {
      method: "POST",
      json: { provider: values.provider, return_url: await returnUrl(bookingId) },
    });
    return { ok: true, checkoutUrl: checkout.checkout_url, bookingId };
  } catch (error) {
    return failure(error, values);
  }
}

/** Ask eSewa / Khalti again (driver closed the payment page, or it is still pending). */
export async function verifyPaymentAction(form: FormData): Promise<void> {
  try {
    const detail = await apiRequest<BookingDetail>(`/payments/${text(form, "payment_id")}/verify`, { method: "POST" });
    const status = detail.latest_payment?.status;
    await flash(
      detail.display_status === "active"
        ? "Payment confirmed. Your parking is booked."
        : status === "pending" || status === "initiated"
          ? "The payment is still pending with the provider. We will keep checking."
          : "Payment status updated.",
      detail.display_status === "active" ? "success" : "info",
    );
  } catch (error) {
    await flash(failure(error).message ?? "Could not check the payment.", "error");
  }
  refresh();
}

export async function cancelBookingAction(form: FormData): Promise<void> {
  try {
    await apiRequest(`/bookings/${text(form, "booking_id")}/cancel`, { method: "POST" });
    await flash("Booking cancelled. The space has been released.", "info");
  } catch (error) {
    await flash(failure(error).message ?? "Could not cancel the booking.", "error");
  }
  refresh();
}
