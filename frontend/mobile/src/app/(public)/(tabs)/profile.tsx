import { router } from "expo-router";
import { ChevronRight, Ticket } from "lucide-react-native";
import { View } from "react-native";

import { ProfileView } from "@/components/profile-view";
import { Card, Header, Row, Screen, Txt } from "@/components/ui";
import { colors } from "@/lib/theme";

export default function Profile() {
  return (
    <Screen>
      <Header title="Profile" subtitle="Account and preferences" />
      <Card onPress={() => router.push("/bookings" as never)} accessibilityLabel="My bookings" style={{ marginBottom: 12 }}>
        <Row>
          <Ticket size={20} color={colors.slate600} />
          <View style={{ flex: 1 }}>
            <Txt variant="h3">My bookings</Txt>
            <Txt variant="small">Paid parking, payments and receipts</Txt>
          </View>
          <ChevronRight size={18} color={colors.slate400} />
        </Row>
      </Card>
      <ProfileView />
    </Screen>
  );
}
