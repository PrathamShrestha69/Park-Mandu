import { ProfileView } from "@/components/profile-view";
import { Header, Screen } from "@/components/ui";

export default function Profile() {
  return (
    <Screen>
      <Header title="Profile" subtitle="Account and preferences" />
      <ProfileView />
    </Screen>
  );
}
