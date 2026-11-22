import { router, useLocalSearchParams } from "expo-router";
import { CircleAlert, CircleCheck, Clock, Hourglass, Lock, Navigation, RefreshCw, XCircle } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { firstUsable, HoursChooser, ProviderChooser } from "@/components/booking";
import { Badge, Button, Callout, Card, ErrorView, FormMessage, Header, KV, Loading, Row, Screen, SectionTitle, Txt } from "@/components/ui";
import { api, formErrors } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { payInBrowser, rupees } from "@/lib/payments";
import { invalidate, useApi } from "@/lib/queries";
import { colors, type Tone } from "@/lib/theme";
import type { BookingDetail, BookingDisplayStatus, PaymentProvider, PaymentProviderOption, PaymentStatus } from "@/lib/types";

const STATUS: Record<BookingDisplayStatus, { label: string; tone: Tone }> = {
  awaiting_payment: { label: "Awaiting payment", tone: "warning" },
  payment_pending: { label: "Payment pending", tone: "warning" },
  active: { label: "Confirmed", tone: "success" },
  ended: { label: "Ended", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  needs_attention: { label: "Refund in progress", tone: "danger" },
};

const PAYMENT: Record<PaymentStatus, { label: string; tone: Tone }> = {
  initiated: { label: "Started", tone: "neutral" },
  pending: { label: "Pending", tone: "warning" },
  completed: { label: "Successful", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  refunded: { label: "Refunded", tone: "info" },
};

function Outcome({ b }: { b: BookingDetail }) {
  const latest = b.latest_payment;
  if (b.display_status === "active")
    return (
      <Callout tone="success" title="Parking confirmed" icon={<CircleCheck size={18} color={colors.green700} />}>
        {`Paid ${rupees(b.amount)}. Your space is booked until ${formatDateTime(b.ends_at)}.`}
      </Callout>
    );
  if (b.display_status === "needs_attention")
    return (
      <Callout tone="danger" title="Payment received, booking not confirmed" icon={<CircleAlert size={18} color={colors.red700} />}>
        {`${latest?.reconciliation_note ?? "We could not confirm the booking."} It will be refunded to your wallet; no action is needed.`}
      </Callout>
    );
  if (b.display_status === "payment_pending" || latest?.status === "pending")
    return (
      <Callout tone="warning" title="Payment pending" icon={<Hourglass size={18} color="#8a5300" />}>
        {`${latest?.provider_label ?? "The provider"} has not confirmed the payment yet. We keep checking; you will not be charged twice.`}
      </Callout>
    );
  if (latest?.status === "cancelled" && b.can_pay)
    return (
      <Callout tone="info" title="Payment cancelled" icon={<XCircle size={18} color={colors.blue700} />}>
        {`No money was taken. Your space is held until ${formatDateTime(b.hold_expires_at)}.`}
      </Callout>
    );
  if (latest?.status === "failed" && b.can_pay)
    return (
      <Callout tone="danger" title="Payment failed" icon={<XCircle size={18} color={colors.red700} />}>
        The payment did not go through. Try again or choose the other method.
      </Callout>
    );
  if (b.display_status === "expired")
    return (
      <Callout tone="info" title="Hold expired" icon={<Clock size={18} color={colors.blue700} />}>
        The space was released because no confirmed payment arrived in time.
      </Callout>
    );
  return null;
}

function PayBox({ payId, returnTo, amount, providers, label, onDone }: { payId: string; returnTo: string; amount: number; providers: PaymentProviderOption[]; label: string; onDone: () => void }) {
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const chosen = provider ?? firstUsable(providers, amount);
  const pay = async () => {
    if (!chosen) return;
    setBusy(true);
    setMessage(null);
    try {
      await payInBrowser(payId, chosen, returnTo);
      onDone();
    } catch (error) {
      setMessage(formErrors(error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <ProviderChooser providers={providers} amount={amount} value={chosen} onChange={setProvider} />
      <FormMessage message={message} />
      <Button title={`${label} · ${rupees(amount)}`} icon={<Lock size={16} color="white" />} onPress={pay} loading={busy} disabled={!chosen} />
    </View>
  );
}

export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string; payment?: string }>();
  const booking = useApi<BookingDetail>(`/bookings/${id}`);
  const providers = useApi<PaymentProviderOption[]>("/payments/providers");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [extendHours, setExtendHours] = useState(1);
  const verified = useRef<string | null>(null);

  const latest = booking.data?.latest_payment;
  const open = latest && (latest.status === "pending" || latest.status === "initiated");
  const refresh = () => {
    void booking.refetch();
    void invalidate("/bookings");
  };

  // Back from the provider (or the browser was closed): ask the server to confirm with eSewa / Khalti once.
  useEffect(() => {
    if (open && latest && verified.current !== latest.id) {
      verified.current = latest.id;
      api(`/payments/${latest.id}/verify`, { method: "POST" })
        .catch(() => undefined)
        .finally(refresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, latest?.id]);

  // While a payment is pending, check again every few seconds.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void booking.refetch(), 8_000);
    return () => clearInterval(timer);
  }, [open, booking]);

  if (booking.isPending || providers.isPending) return <Loading />;
  if (booking.isError) return <Screen><ErrorView error={booking.error} onRetry={() => booking.refetch()} /></Screen>;
  const b = booking.data;
  const list = providers.data ?? [];
  const status = STATUS[b.display_status];
  const pendingExtension = b.extensions.find((e) => e.display_status === "awaiting_payment" || e.display_status === "payment_pending");
  const totalHours = b.hours + b.extensions.filter((e) => e.status === "confirmed").reduce((n, e) => n + e.hours, 0);

  const act = async (key: string, run: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await run();
      if (done) setMessage(done);
    } catch (error) {
      setMessage(formErrors(error).message);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const extend = () =>
    act("extend", async () => {
      const detail = await api<BookingDetail>(`/bookings/${b.id}/extend`, { method: "POST", json: { hours: extendHours } });
      const ext = detail.extensions.find((e) => e.status === "pending_payment");
      const method = firstUsable(list, Number(b.price_per_hour) * extendHours);
      if (ext && method) await payInBrowser(ext.id, method, b.id);
    });

  return (
    <Screen refreshing={booking.isRefetching} onRefresh={refresh}>
      <Header title={b.parking.name} subtitle={b.reference ?? undefined} back />
      <View style={{ gap: 12 }}>
        <Row style={{ justifyContent: "flex-start" }}>
          <Badge tone={status.tone}>{status.label}</Badge>
        </Row>
        <Outcome b={b} />
        <Card style={{ gap: 2 }}>
          <KV label="Duration" value={`${totalHours} hours`} />
          <KV label="Rate" value={`${rupees(b.price_per_hour)} per hour`} />
          <KV label="Amount" value={rupees(b.amount)} />
          {b.vehicle_plate && <KV label="Vehicle" value={b.vehicle_plate} />}
          {b.starts_at && <KV label="Starts" value={formatDateTime(b.starts_at)} />}
          {b.ends_at && <KV label="Expires" value={formatDateTime(b.ends_at)} />}
          {b.can_pay && b.hold_expires_at && <KV label="Space held until" value={formatDateTime(b.hold_expires_at)} />}
        </Card>

        {b.can_pay && (
          <Card style={{ gap: 10 }}>
            <Txt variant="h3">{latest ? "Try the payment again" : "Pay for this booking"}</Txt>
            <PayBox payId={b.id} returnTo={b.id} amount={Number(b.amount)} providers={list} label={latest ? "Pay again" : "Pay now"} onDone={refresh} />
          </Card>
        )}

        {pendingExtension && (
          <Card style={{ gap: 10 }}>
            <Txt variant="h3">{`Extension of ${pendingExtension.hours} h waiting for payment`}</Txt>
            <PayBox payId={pendingExtension.id} returnTo={b.id} amount={Number(pendingExtension.amount)} providers={list} label="Pay for extension" onDone={refresh} />
          </Card>
        )}

        {b.can_extend && !pendingExtension && (
          <Card style={{ gap: 10 }}>
            <Txt variant="h3">Need more time?</Txt>
            <HoursChooser max={b.max_extension_hours} value={extendHours} onChange={setExtendHours} prefix="+" />
            <Button title={`Extend · ${rupees(Number(b.price_per_hour) * extendHours)}`} onPress={extend} loading={busy === "extend"} />
          </Card>
        )}

        <FormMessage message={message} />

        {b.payments.length > 0 && (
          <>
            <SectionTitle title="Payments" />
            <Card style={{ gap: 10 }}>
              {b.payments.map((p) => (
                <Row key={p.id} style={{ justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="label">{`${p.provider_label} · ${rupees(p.amount)}`}</Txt>
                    <Txt variant="small">{`${formatDateTime(p.created_at)} · Ref ${p.provider_transaction_id ?? p.transaction_uuid}`}</Txt>
                  </View>
                  <Badge tone={PAYMENT[p.status].tone}>{PAYMENT[p.status].label}</Badge>
                </Row>
              ))}
            </Card>
          </>
        )}

        <Button
          title="Directions to the parking"
          variant="secondary"
          icon={<Navigation size={18} color={colors.slate700} />}
          onPress={() => router.navigate({ pathname: "/explore", params: { navigate: b.parking.id } } as never)}
        />
        {open && latest && (
          <Button
            title="Check payment status"
            variant="secondary"
            icon={<RefreshCw size={16} color={colors.slate700} />}
            loading={busy === "verify"}
            onPress={() => act("verify", () => api(`/payments/${latest.id}/verify`, { method: "POST" }))}
          />
        )}
        {b.can_cancel && (
          <Button
            title="Cancel booking"
            variant="ghost"
            loading={busy === "cancel"}
            onPress={() => act("cancel", () => api(`/bookings/${b.id}/cancel`, { method: "POST" }), "Booking cancelled. The space has been released.")}
          />
        )}
      </View>
    </Screen>
  );
}
