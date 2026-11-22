import { router } from "expo-router";
import { CreditCard, Lock } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Button, Card, Chips, Field, FormMessage, Row, Txt } from "@/components/ui";
import { formErrors } from "@/lib/api";
import { createBooking, payInBrowser, rupees } from "@/lib/payments";
import { useApi } from "@/lib/queries";
import { colors, radius } from "@/lib/theme";
import type { BookingQuote, ParkingDetail, PaymentProvider, PaymentProviderOption } from "@/lib/types";

const BRAND: Record<PaymentProvider, string> = { esewa: "#60bb46", khalti: "#5c2d91" };

export function ProviderChooser({
  providers,
  amount,
  value,
  onChange,
}: {
  providers: PaymentProviderOption[];
  amount: number;
  value: PaymentProvider | null;
  onChange: (p: PaymentProvider) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Txt variant="label">Pay with</Txt>
      <Row gap={8}>
        {providers.map((p) => {
          const tooSmall = amount < Number(p.min_amount);
          const disabled = !p.enabled || tooSmall;
          const on = value === p.id && !disabled;
          return (
            <Pressable
              key={p.id}
              disabled={disabled}
              onPress={() => onChange(p.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled }}
              style={[styles.provider, { borderColor: on ? BRAND[p.id] : colors.slate200, backgroundColor: on ? `${BRAND[p.id]}14` : colors.white, opacity: disabled ? 0.5 : 1 }]}
            >
              <Txt variant="h3" color={on ? BRAND[p.id] : undefined}>
                {p.label}
              </Txt>
              <Txt variant="small">{!p.enabled ? "Not available" : tooSmall ? `Minimum ${rupees(p.min_amount)}` : p.environment === "sandbox" ? "Test mode" : "Secure payment"}</Txt>
            </Pressable>
          );
        })}
      </Row>
    </View>
  );
}

export function firstUsable(providers: PaymentProviderOption[], amount: number): PaymentProvider | null {
  return providers.find((p) => p.enabled && amount >= Number(p.min_amount))?.id ?? null;
}

export function HoursChooser({ max, value, onChange, prefix = "" }: { max: number; value: number; onChange: (h: number) => void; prefix?: string }) {
  const options = Array.from({ length: Math.max(1, max) }, (_, i) => ({ value: String(i + 1), label: `${prefix}${i + 1} h` }));
  return <Chips options={options} value={String(value)} onChange={(v) => onChange(Number(v))} />;
}

/** Choose hours, see the total from this parking's own hourly rate, and pay with eSewa or Khalti. */
export function BookParkingCard({ parking }: { parking: ParkingDetail }) {
  const paid = parking.pricing_mode === "hourly" && !!parking.price_per_hour;
  const quote = useApi<BookingQuote>(`/parkings/${parking.id}/booking-quote`, { hours: 1 }, { enabled: paid });
  const [hours, setHours] = useState(1);
  const [plate, setPlate] = useState("");
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!paid) return null;
  if (quote.isPending) return null;
  if (quote.isError)
    return (
      <Card style={{ gap: 6 }}>
        <Txt variant="h3">Online booking</Txt>
        <Txt variant="muted">{formErrors(quote.error).message}</Txt>
      </Card>
    );
  const q = quote.data;
  const rate = Number(q.price_per_hour);
  const total = rate * hours;
  const chosen = provider && firstUsable(q.providers.filter((p) => p.id === provider), total) ? provider : firstUsable(q.providers, total);
  const unavailable = q.bookable_spaces < 1 || q.max_hours < 1;

  const pay = async () => {
    if (!chosen) return;
    setBusy(true);
    setMessage(null);
    try {
      const bookingId = await createBooking(parking.id, hours, plate.trim() || null);
      const outcome = await payInBrowser(bookingId, chosen, bookingId);
      router.push({ pathname: "/booking/[id]", params: { id: bookingId, ...(outcome ? { payment: outcome } : {}) } } as never);
    } catch (error) {
      setMessage(formErrors(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 14 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Txt variant="h3">Book a space</Txt>
          <Txt variant="small">{unavailable ? "No space can be booked right now." : `${q.bookable_spaces} space${q.bookable_spaces === 1 ? "" : "s"} can be booked now`}</Txt>
        </View>
        <CreditCard size={20} color={colors.slate500} />
      </Row>
      {!unavailable && (
        <>
          <View style={{ gap: 8 }}>
            <Txt variant="label">How long?</Txt>
            <HoursChooser max={q.max_hours} value={hours} onChange={setHours} />
          </View>
          <Field label="Vehicle number (optional)" value={plate} onChangeText={setPlate} placeholder="e.g. Ba 2 Pa 1234" autoCapitalize="words" maxLength={32} />
          <View style={styles.total}>
            <Txt variant="muted">
              {rupees(rate)} × {hours} h
            </Txt>
            <Txt variant="h2">{rupees(total)}</Txt>
          </View>
          <ProviderChooser providers={q.providers} amount={total} value={chosen} onChange={setProvider} />
          <FormMessage message={message} />
          <Button title={`Pay ${rupees(total)}`} icon={<Lock size={16} color="white" />} onPress={pay} loading={busy} disabled={!chosen} />
          <Txt variant="small">The space is held for {q.hold_minutes} minutes while you pay. Parking time starts when the payment is confirmed.</Txt>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  provider: { flex: 1, gap: 2, padding: 12, borderRadius: radius.sm, borderWidth: 1.5 },
  total: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12, borderRadius: radius.sm, backgroundColor: colors.slate100 },
});
