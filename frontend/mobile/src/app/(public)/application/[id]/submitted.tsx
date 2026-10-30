import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { Check, Clock, Copy } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Badge, Button, Callout, Card, Loading, Row, Screen, Txt } from "@/components/ui";
import { useApi } from "@/lib/queries";
import { colors } from "@/lib/theme";
import type { ApplicationDetail } from "@/lib/types";

export default function Submitted() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApi<ApplicationDetail>(`/applications/${id}`);
  const [copied, setCopied] = useState(false);
  if (!app.data) return <Loading />;

  return (
    <Screen contentStyle={{ paddingTop: 48, alignItems: "stretch" }}>
      <View style={{ alignItems: "center", gap: 12 }}>
        <View style={styles.ring}>
          <Check size={44} color="white" strokeWidth={2.6} />
        </View>
        <Badge tone="success">Submission received</Badge>
        <Txt variant="h1" style={{ textAlign: "center" }}>
          Application submitted successfully
        </Txt>
        <Txt variant="muted" style={{ textAlign: "center" }}>
          Your parking location is now under government review.
        </Txt>
      </View>
      <Card style={{ marginVertical: 22 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <View>
            <Txt variant="small">Application reference</Txt>
            <Txt variant="h2">{app.data.reference}</Txt>
          </View>
          <Button
            small
            variant="secondary"
            title={copied ? "Copied" : "Copy"}
            icon={<Copy size={15} color={colors.blue700} />}
            onPress={async () => {
              if (app.data.reference) await Clipboard.setStringAsync(app.data.reference);
              setCopied(true);
            }}
          />
        </Row>
      </Card>
      <Callout title="What happens next" icon={<Clock size={18} color={colors.blue700} />}>
        A registration officer will review your property and documents. Review times vary; we will notify you when the status changes or if more information is needed.
      </Callout>
      <Button title="View application status" style={{ marginTop: 20 }} onPress={() => router.replace(`/application/${id}` as never)} />
      <Button title="Return to home" variant="ghost" onPress={() => router.replace("/home")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  ring: { width: 92, height: 92, borderRadius: 46, backgroundColor: colors.green500, alignItems: "center", justifyContent: "center", borderWidth: 12, borderColor: colors.green100 },
});
