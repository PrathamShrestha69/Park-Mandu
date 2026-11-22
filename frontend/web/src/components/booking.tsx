"use client";

import { CircleAlert, CreditCard, LoaderCircle, Lock } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { type CheckoutState, checkoutAction, extendAction, payAction } from "@/lib/actions/bookings";
import type { PaymentProvider, PaymentProviderOption } from "@/lib/types";
import { cn } from "@/lib/utils";

const PROVIDER_STYLE: Record<PaymentProvider, string> = {
  esewa: "has-checked:border-[#60bb46] has-checked:bg-[#60bb46]/10",
  khalti: "has-checked:border-[#5c2d91] has-checked:bg-[#5c2d91]/10",
};

const rupees = (amount: number) => `Rs ${amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Runs a checkout Server Action and sends the browser to eSewa / Khalti when it succeeds. */
function useCheckout(action: (state: CheckoutState, form: FormData) => Promise<CheckoutState>) {
  const [state, formAction, pending] = useActionState(async (prev: CheckoutState, form: FormData) => {
    try {
      return await action(prev, form);
    } catch {
      return { ok: false, message: "Unable to connect to the server. Check your internet connection." } as CheckoutState;
    }
  }, {});
  // Once the action returns a checkout address the browser is on its way to the provider.
  const leaving = Boolean(state.ok && state.checkoutUrl);
  useEffect(() => {
    if (state.ok && state.checkoutUrl) window.location.assign(state.checkoutUrl);
  }, [state]);
  return { state, formAction, busy: pending || leaving, leaving };
}

function ProviderPicker({ providers, amount, error }: { providers: PaymentProviderOption[]; amount: number; error?: string }) {
  const usable = providers.filter((p) => p.enabled && amount >= Number(p.min_amount));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">Pay with</legend>
      <div className="grid grid-cols-2 gap-2">
        {providers.map((p) => {
          const tooSmall = amount < Number(p.min_amount);
          const disabled = !p.enabled || tooSmall;
          return (
            <label
              key={p.id}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-lg border bg-card px-3 py-2.5 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                PROVIDER_STYLE[p.id],
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input type="radio" name="provider" value={p.id} disabled={disabled} defaultChecked={usable[0]?.id === p.id} className="sr-only" />
              <span className="font-semibold">{p.label}</span>
              <span className="text-xs text-muted-foreground">
                {!p.enabled ? "Not available" : tooSmall ? `Minimum ${rupees(Number(p.min_amount))}` : p.environment === "sandbox" ? "Test mode" : "Secure payment"}
              </span>
            </label>
          );
        })}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {usable.length === 0 && <p className="text-sm text-muted-foreground">Online payment is not available for this amount right now.</p>}
    </fieldset>
  );
}

function CheckoutMessage({ state, leaving }: { state: CheckoutState; leaving: boolean }) {
  if (leaving)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" /> Taking you to the payment page…
      </p>
    );
  if (!state.message) return null;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive" role="alert">
      <span className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0" /> {state.message}
      </span>
      {state.bookingId && (
        <Link href={`/bookings/${state.bookingId}`} className="font-medium underline underline-offset-4">
          Open the booking
        </Link>
      )}
    </div>
  );
}

/** Choose hours, see the price from this parking's own hourly rate, and pay with eSewa or Khalti. */
export function BookParking({
  parkingId,
  pricePerHour,
  maxHours,
  bookable,
  holdMinutes,
  providers,
}: {
  parkingId: string;
  pricePerHour: number;
  maxHours: number;
  bookable: number;
  holdMinutes: number;
  providers: PaymentProviderOption[];
}) {
  const [hours, setHours] = useState(1);
  const { state, formAction, busy, leaving } = useCheckout(checkoutAction);
  const total = pricePerHour * hours;
  const unavailable = bookable < 1 || maxHours < 1;

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-xl border bg-card p-4" aria-label="Book and pay">
      <input type="hidden" name="parking_id" value={parkingId} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Book a space</h2>
          <p className="text-sm text-muted-foreground">
            {unavailable ? "No space can be booked right now." : `${bookable} space${bookable === 1 ? "" : "s"} can be booked now.`}
          </p>
        </div>
        <CreditCard className="size-5 text-muted-foreground" />
      </div>
      {!unavailable && (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            How long?
            <select
              name="hours"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              {Array.from({ length: maxHours }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {h} hour{h === 1 ? "" : "s"}
                </option>
              ))}
            </select>
            {state.fields?.hours && <span className="text-destructive">{state.fields.hours}</span>}
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Vehicle number <span className="font-normal text-muted-foreground">(optional)</span>
            <input name="vehicle_plate" maxLength={32} placeholder="e.g. Ba 2 Pa 1234" defaultValue={state.values?.vehicle_plate} className="h-10 rounded-md border bg-background px-3 text-sm" />
          </label>
          <div className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2.5">
            <span className="text-sm text-muted-foreground">
              {rupees(pricePerHour)} × {hours} h
            </span>
            <strong className="font-heading text-xl font-semibold">{rupees(total)}</strong>
          </div>
          <ProviderPicker providers={providers} amount={total} error={state.fields?.provider} />
          <CheckoutMessage state={state} leaving={leaving} />
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Lock />} Pay {rupees(total)}
          </Button>
          <p className="text-xs text-muted-foreground">
            The space is held for {holdMinutes} minutes while you pay. Parking time starts when the payment is confirmed.
          </p>
        </>
      )}
    </form>
  );
}

/** Retry payment for a held booking (or pay a pending extension), choosing the method again. */
export function PayAgain({ bookingId, amount, providers, label = "Pay now" }: { bookingId: string; amount: number; providers: PaymentProviderOption[]; label?: string }) {
  const { state, formAction, busy, leaving } = useCheckout(payAction);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="booking_id" value={bookingId} />
      <ProviderPicker providers={providers} amount={amount} />
      <CheckoutMessage state={state} leaving={leaving} />
      <Button type="submit" disabled={busy}>
        {busy ? <LoaderCircle className="animate-spin" /> : <Lock />} {label} · {rupees(amount)}
      </Button>
    </form>
  );
}

/** Add hours to a running booking and pay for them. */
export function ExtendBooking({ bookingId, pricePerHour, maxHours, providers }: { bookingId: string; pricePerHour: number; maxHours: number; providers: PaymentProviderOption[] }) {
  const [hours, setHours] = useState(1);
  const { state, formAction, busy, leaving } = useCheckout(extendAction);
  const total = pricePerHour * hours;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="booking_id" value={bookingId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Add
        <select name="hours" value={hours} onChange={(e) => setHours(Number(e.target.value))} className="h-10 rounded-md border bg-background px-3 text-sm">
          {Array.from({ length: maxHours }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>
              {h} more hour{h === 1 ? "" : "s"} · {rupees(pricePerHour * h)}
            </option>
          ))}
        </select>
      </label>
      <ProviderPicker providers={providers} amount={total} />
      <CheckoutMessage state={state} leaving={leaving} />
      <Button type="submit" disabled={busy}>
        {busy ? <LoaderCircle className="animate-spin" /> : <Lock />} Extend · {rupees(total)}
      </Button>
    </form>
  );
}
