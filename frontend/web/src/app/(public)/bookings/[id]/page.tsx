import { CircleAlert, CircleCheck, Clock, Hourglass, MapPin, Navigation, RefreshCw, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ExtendBooking, PayAgain } from "@/components/booking";
import { Badge, Callout, KV, PageHead, PageSkeleton } from "@/components/common";
import { AutoRefresh } from "@/components/interactive";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelBookingAction, verifyPaymentAction } from "@/lib/actions/bookings";
import { apiGet } from "@/lib/api";
import { param } from "@/lib/api-query";
import { BOOKING_STATUS, PAYMENT_STATUS, formatDateTime, formatRupees } from "@/lib/format";
import type { BookingDetail, PaymentProviderOption } from "@/lib/types";

export const metadata: Metadata = { title: "Booking" };

/** What to tell the driver first: the outcome they just came back from, confirmed against the API. */
function Outcome({ booking, returned }: { booking: BookingDetail; returned?: string }) {
  const latest = booking.latest_payment;
  if (booking.display_status === "active")
    return (
      <Callout tone="success" icon={<CircleCheck />} title={returned ? "Payment successful" : "Parking confirmed"}>
        Paid {formatRupees(booking.amount)} with {booking.payments.find((p) => p.status === "completed")?.provider_label ?? "your wallet"}. Your space is booked until{" "}
        <strong>{formatDateTime(booking.ends_at)}</strong>.
      </Callout>
    );
  if (booking.display_status === "needs_attention")
    return (
      <Callout tone="danger" icon={<CircleAlert />} title="Payment received, booking not confirmed">
        {latest?.reconciliation_note ?? "We received your payment but could not confirm the booking."} It will be refunded to your wallet; no action is needed.
      </Callout>
    );
  if (booking.display_status === "payment_pending" || latest?.status === "pending")
    return (
      <Callout tone="warning" icon={<Hourglass />} title="Payment pending">
        {latest?.provider_label ?? "The provider"} has not confirmed the payment yet. This page checks again automatically; you will not be charged twice.
      </Callout>
    );
  if (latest?.status === "cancelled" && booking.can_pay)
    return (
      <Callout tone="info" icon={<XCircle />} title="Payment cancelled">
        No money was taken. Your space is still held until {formatDateTime(booking.hold_expires_at)}. You can pay again below.
      </Callout>
    );
  if (latest?.status === "failed" && booking.can_pay)
    return (
      <Callout tone="danger" icon={<XCircle />} title="Payment failed">
        The payment did not go through. Try again or choose the other payment method.
      </Callout>
    );
  if (booking.display_status === "expired")
    return (
      <Callout tone="info" icon={<Clock />} title="Hold expired">
        The space was released because no confirmed payment arrived in time. Book again from the parking page.
      </Callout>
    );
  return null;
}

async function BookingContent(props: PageProps<"/bookings/[id]">) {
  const [{ id }, params] = await Promise.all([props.params, props.searchParams]);
  const [booking, providers] = await Promise.all([
    apiGet<BookingDetail>(`/bookings/${id}`),
    apiGet<PaymentProviderOption[]>("/payments/providers"),
  ]);
  const returned = param(params, "payment");
  const status = BOOKING_STATUS[booking.display_status];
  const pendingExtension = booking.extensions.find((e) => e.display_status === "awaiting_payment" || e.display_status === "payment_pending");
  const latest = booking.latest_payment;
  const checkable = latest && (latest.status === "pending" || latest.status === "initiated");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHead
        back="/bookings"
        eyebrow={booking.reference}
        title={booking.parking.name}
        subtitle={booking.parking.address}
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      {(booking.display_status === "payment_pending" || checkable) && <AutoRefresh ms={8_000} />}

      <div className="flex flex-col gap-4">
        <Outcome booking={booking} returned={returned} />

        <Card>
          <CardHeader>
            <CardTitle className="font-semibold">Booking</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <KV label="Duration" value={`${booking.hours + booking.extensions.filter((e) => e.status === "confirmed").reduce((n, e) => n + e.hours, 0)} hours`} />
              <KV label="Rate" value={`${formatRupees(booking.price_per_hour)} per hour`} />
              <KV label="Amount" value={formatRupees(booking.amount)} />
              {booking.vehicle_plate && <KV label="Vehicle" value={booking.vehicle_plate} />}
              {booking.starts_at && <KV label="Starts" value={formatDateTime(booking.starts_at)} />}
              {booking.ends_at && <KV label="Expires" value={<strong>{formatDateTime(booking.ends_at)}</strong>} />}
              {booking.can_pay && booking.hold_expires_at && <KV label="Space held until" value={formatDateTime(booking.hold_expires_at)} />}
            </dl>
          </CardContent>
        </Card>

        {booking.can_pay && (
          <Card>
            <CardHeader>
              <CardTitle className="font-semibold">{latest ? "Try the payment again" : "Pay for this booking"}</CardTitle>
            </CardHeader>
            <CardContent>
              <PayAgain bookingId={booking.id} amount={Number(booking.amount)} providers={providers} label={latest ? "Pay again" : "Pay now"} />
            </CardContent>
          </Card>
        )}

        {pendingExtension && (
          <Card>
            <CardHeader>
              <CardTitle className="font-semibold">Extension of {pendingExtension.hours} h waiting for payment</CardTitle>
            </CardHeader>
            <CardContent>
              <PayAgain bookingId={pendingExtension.id} amount={Number(pendingExtension.amount)} providers={providers} label="Pay for extension" />
            </CardContent>
          </Card>
        )}

        {booking.can_extend && !pendingExtension && (
          <Card>
            <CardHeader>
              <CardTitle className="font-semibold">Need more time?</CardTitle>
            </CardHeader>
            <CardContent>
              <ExtendBooking bookingId={booking.id} pricePerHour={Number(booking.price_per_hour)} maxHours={booking.max_extension_hours} providers={providers} />
            </CardContent>
          </Card>
        )}

        {booking.payments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="font-semibold">Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y text-sm">
                {booking.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span>
                      <strong>{p.provider_label}</strong> · {formatRupees(p.amount)} · {formatDateTime(p.created_at)}
                      <span className="block text-xs text-muted-foreground">Ref {p.provider_transaction_id ?? p.transaction_uuid}</span>
                    </span>
                    <Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/parking/${booking.parking.id}#directions`}>
              <Navigation /> Directions to the parking
            </Link>
          </Button>
          {checkable && (
            <form action={verifyPaymentAction}>
              <input type="hidden" name="payment_id" value={latest.id} />
              <Button type="submit" variant="outline">
                <RefreshCw /> Check payment status
              </Button>
            </form>
          )}
          {booking.can_cancel && (
            <form action={cancelBookingAction}>
              <input type="hidden" name="booking_id" value={booking.id} />
              <Button type="submit" variant="ghost" className="text-destructive">
                Cancel booking
              </Button>
            </form>
          )}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5" /> Payments are confirmed with eSewa or Khalti by Park Mandu&apos;s server before a booking counts.
        </p>
      </div>
    </div>
  );
}

export default function BookingPage(props: PageProps<"/bookings/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BookingContent {...props} />
    </Suspense>
  );
}
