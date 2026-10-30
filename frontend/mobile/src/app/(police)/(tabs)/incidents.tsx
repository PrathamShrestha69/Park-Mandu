import { Siren } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { PagedList } from "@/components/paged-list";
import { IncidentRow } from "@/components/police";
import { Chips, Empty, Header } from "@/components/ui";
import type { IncidentSummary } from "@/lib/types";

export default function Incidents() {
  const [status, setStatus] = useState<"in_progress" | "resolved" | "all">("in_progress");
  const [scope, setScope] = useState<"mine" | "everyone">("mine");

  return (
    <PagedList<IncidentSummary>
      path="/incidents"
      query={{ status: status === "all" ? undefined : status, mine: scope === "mine" }}
      renderItem={(i) => <IncidentRow incident={i} />}
      empty={<Empty icon={<Siren size={26} color="#0859ac" />} title="No incidents here" body="Take ownership of an alert to open an incident." />}
      header={
        <View>
          <Header title="Incidents" subtitle="Alerts that an officer has taken ownership of" />
          <Chips
            value={scope}
            onChange={setScope}
            options={[
              { value: "mine", label: "Assigned to me" },
              { value: "everyone", label: "All officers" },
            ]}
          />
          <Chips
            value={status}
            onChange={setStatus}
            options={[
              { value: "in_progress", label: "In progress" },
              { value: "resolved", label: "Resolved" },
              { value: "all", label: "All" },
            ]}
          />
        </View>
      }
    />
  );
}
