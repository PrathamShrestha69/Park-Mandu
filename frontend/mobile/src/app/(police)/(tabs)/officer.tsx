import { DutyToggle } from "@/components/police";
import { ProfileView } from "@/components/profile-view";
import { Card, Header, Row, Screen, Txt } from "@/components/ui";
import { useViewer } from "@/lib/auth";

export default function OfficerProfile() {
  const user = useViewer();
  return (
    <Screen>
      <Header title="Profile" subtitle="Duty status and account" />
      <ProfileView
        extra={
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt variant="label">{user.on_duty ? "You are receiving live alerts." : "You are off duty."}</Txt>
              <DutyToggle />
            </Row>
          </Card>
        }
      />
    </Screen>
  );
}
