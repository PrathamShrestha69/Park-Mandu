import { router } from "expo-router";
import { ChevronRight, Ticket } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { PagedList } from "@/components/paged-list";
import { Badge, Card, Chips, Empty, Header, Row, Txt } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { rupees } from "@/lib/payments";
import type { Tone } from "@/lib/theme";
import type { BookingSummary } from "@/lib/types";

const STATUS: Record<BookingSummary["display_status"], { label: string; tone: Tone }> = {
  awaiting_payment: { label: "Awaiting payment", tone: "warning" },
  payment_pending: { label: "Payment pending", tone: "warning" },
  active: { label: "Confirmed", tone: "success" },
  ended: { label: "Ended", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  needs_attention: { label: "Refund in progress", tone: "danger" },
};

type Scope = "all" | "active" | "past";

export default function Bookings() {
  const [scope, setScope] = useState<Scope>("all");
  return (
    <PagedList<BookingSummary>
        path="/bookings"
        query={{ scope }}
        header={
          <View>
            <Header title="My bookings" subtitle="Paid parking booked with eSewa or Khalti" back />
            <Chips<Scope>
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
                { value: "past", label: "Past" },
              ]}
              value={scope}
              onChange={setScope}
            />
          </View>
        }
        renderItem={(b) => (
          <Card onPress={() => router.push(`/booking/${b.id}` as never)} accessibilityLabel={`${b.parking.name}, ${STATUS[b.display_status].label}`}>
            <Row>
              <View style={{ flex: 1, gap: 4 }}>
                <Row gap={8}>
                  <Txt variant="h3" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {b.parking.name}
                  </Txt>
                  <Badge tone={STATUS[b.display_status].tone}>{STATUS[b.display_status].label}</Badge>
                </Row>
                <Txt variant="small">
                  {`${b.reference} · ${b.hours} h · ${rupees(b.amount)}${b.ends_at ? ` · until ${formatDateTime(b.ends_at)}` : ""}`}
                </Txt>
              </View>
              <ChevronRight size={18} color="#a2a4ab" />
            </Row>
          </Card>
        )}
        empty={<Empty icon={<Ticket size={22} color="#656972" />} title="No bookings yet" body="Paid parking can be booked from its page on the map." />}
      />
  );
}
