import { useMutation } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import { Button, Callout, Card, Chips, Field, FormMessage, Header, Screen, Txt } from "@/components/ui";
import { api, formErrors } from "@/lib/api";

const CATEGORIES = [
  { value: "wrong_information", label: "Wrong information" },
  { value: "closed_or_full", label: "Closed or full" },
  { value: "overcharging", label: "Overcharging" },
  { value: "safety", label: "Safety" },
  { value: "other", label: "Other" },
] as const;
type Category = (typeof CATEGORIES)[number]["value"];

export default function ReportIssue() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [category, setCategory] = useState<Category>("wrong_information");
  const [description, setDescription] = useState("");
  const send = useMutation({
    mutationFn: () => api(`/parkings/${id}/reports`, { method: "POST", json: { category, description } }),
    onSuccess: () => {
      Alert.alert("Report sent", "Thank you — the parking authority has been notified.");
      router.back();
    },
  });
  const error = send.error ? formErrors(send.error) : null;

  return (
    <Screen>
      <Header title="Report an issue" subtitle="Help keep parking information accurate" back />
      <Card style={{ gap: 16 }}>
        <Txt variant="label">What is the problem?</Txt>
        <Chips<Category> value={category} onChange={setCategory} options={[...CATEGORIES]} />
        <Field
          label="Describe what happened"
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder="e.g. The gate was closed at 18:00 although the hours say 21:00."
          hint="At least 10 characters."
          error={error?.fields.description}
        />
        <Callout>Reports go to the authority responsible for this location.</Callout>
        <FormMessage message={error?.message} />
        <Button title="Send report" loading={send.isPending} onPress={() => send.mutate()} />
      </Card>
    </Screen>
  );
}
