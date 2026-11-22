import type { Metadata } from "next";
import { Suspense } from "react";

import { ActionForm, FormAlert, SelectField, SubmitButton, TextAreaField } from "@/components/forms";
import { Callout, PageHead, PageSkeleton, surface } from "@/components/common";
import { reportIssueAction } from "@/lib/actions/applications";
import { apiGet } from "@/lib/api";
import type { ParkingDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Report an issue" };

const CATEGORIES = [
  { value: "wrong_information", label: "Information is wrong or outdated" },
  { value: "closed_or_full", label: "Closed or full when shown as open" },
  { value: "overcharging", label: "Charged more than the listed fee" },
  { value: "safety", label: "Safety or accessibility concern" },
  { value: "other", label: "Something else" },
];

async function ReportIssuePageContent(props: PageProps<"/parking/[id]/report">) {
  const { id } = await props.params;
  const parking = await apiGet<ParkingDetail>(`/parkings/${id}`);
  return (
    <div className="w-full max-w-3xl">
      <PageHead title="Report an issue" subtitle={parking.name} back={`/parking/${id}`} />
      <div className={cn(surface, "p-5")}>
        <ActionForm action={reportIssueAction}>
          <input type="hidden" name="parking_id" value={id} />
          <SelectField name="category" label="What is the problem?" options={CATEGORIES} defaultValue="wrong_information" />
          <TextAreaField
            name="description"
            label="Describe what happened"
            placeholder="e.g. The gate was closed at 18:00 although the hours say 21:00."
            hint="At least 10 characters. Do not include personal details of other people."
            rows={5}
          />
          <Callout>Reports go to the parking authority responsible for this location. You may be contacted for details.</Callout>
          <FormAlert />
          <SubmitButton pendingLabel="Sending…">Send report</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function ReportIssuePage(props: PageProps<"/parking/[id]/report">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReportIssuePageContent {...props} />
    </Suspense>
  );
}
