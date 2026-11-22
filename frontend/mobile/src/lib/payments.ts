import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { api, ApiError } from "./api";
import type { BookingDetail, PaymentProvider } from "./types";

interface CheckoutOut {
  booking_id: string;
  checkout_url: string;
}

/** The app screen eSewa / Khalti send the driver back to (exp://… in Expo Go, parkmandu://… in a build). */
export const bookingReturnUrl = (bookingId: string) => Linking.createURL(`/booking/${bookingId}`);

/**
 * Pays for a booking (or an extension) in an in-app browser and comes back to the app.
 * Returns the outcome the provider redirected with ("completed", "cancelled", …), or null when the
 * driver closed the browser; the booking screen then asks the API, which asks the provider.
 * Prices, signatures and verification all happen on the Park Mandu server.
 */
export async function payInBrowser(payBookingId: string, provider: PaymentProvider, returnTo: string): Promise<string | null> {
  const returnUrl = bookingReturnUrl(returnTo);
  const checkout = await api<CheckoutOut>(`/bookings/${payBookingId}/payments`, {
    method: "POST",
    json: { provider, return_url: returnUrl },
  });
  const result = await WebBrowser.openAuthSessionAsync(checkout.checkout_url, returnUrl);
  if (result.type !== "success") return null;
  return Linking.parse(result.url).queryParams?.payment?.toString() ?? null;
}

/** Holds a space for `hours`; reuses this driver's booking if one is already waiting for payment. */
export async function createBooking(parkingId: string, hours: number, vehiclePlate: string | null): Promise<string> {
  try {
    const booking = await api<BookingDetail>("/bookings", {
      method: "POST",
      json: { parking_id: parkingId, hours, vehicle_plate: vehiclePlate },
    });
    return booking.id;
  } catch (error) {
    if (error instanceof ApiError && error.code === "booking_pending" && error.fields.booking_id) return error.fields.booking_id;
    throw error;
  }
}

export const rupees = (amount: string | number) => `Rs ${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
