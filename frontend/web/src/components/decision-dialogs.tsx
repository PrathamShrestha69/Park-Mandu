import { Check, FilePlus2, MessageSquare, TriangleAlert } from "lucide-react";

import { decideAction } from "@/lib/actions/operations";

import { ActionForm, FormAlert, SubmitButton, TextAreaField } from "./forms";
import { Dialog } from "./interactive";

const COPY = {
  approve: {
    trigger: (
      <>
        <Check /> Approve application
      </>
    ),
    icon: <Check />,
    iconClassName: "bg-success/12 text-success-ink",
    title: "Approve this application?",
    body: "The location will be added to the approved parking register and shown on the public map. The applicant is notified.",
    confirm: "Confirm approval",
    variant: "primary" as const,
    triggerVariant: "default" as const,
  },
  request_changes: {
    trigger: "Request changes",
    icon: <MessageSquare />,
    iconClassName: "bg-brand/10 text-brand-ink",
    title: "Request application changes",
    body: "Explain exactly what the applicant must correct. They can edit and resubmit the same application.",
    confirm: "Send request",
    variant: "primary" as const,
    triggerVariant: "outline" as const,
  },
  request_documents: {
    trigger: "Request documents",
    icon: <FilePlus2 />,
    iconClassName: "bg-brand/10 text-brand-ink",
    title: "Request additional documents",
    body: "Name the documents that are missing or unclear (e.g. surveyed boundary plan).",
    confirm: "Send request",
    variant: "primary" as const,
    triggerVariant: "outline" as const,
  },
  reject: {
    trigger: "Reject",
    icon: <TriangleAlert />,
    iconClassName: "bg-destructive/10 text-destructive",
    title: "Reject this application?",
    body: "Provide a clear reason. This feedback is sent to the applicant and kept in the audit log.",
    confirm: "Reject application",
    variant: "danger" as const,
    triggerVariant: "destructive" as const,
  },
};

export function DecisionDialog({ applicationId, decision }: { applicationId: string; decision: keyof typeof COPY }) {
  const copy = COPY[decision];
  return (
    <Dialog
      trigger={copy.trigger}
      triggerVariant={copy.triggerVariant}
      icon={copy.icon}
      iconClassName={copy.iconClassName}
      title={copy.title}
      description={copy.body}
    >
      <ActionForm action={decideAction} className="flex flex-col gap-4">
        <input type="hidden" name="application_id" value={applicationId} />
        <input type="hidden" name="decision" value={decision} />
        {decision !== "approve" && (
          <TextAreaField name="feedback" label="Feedback / reason" placeholder="Enter a clear reason for the applicant…" rows={4} />
        )}
        <FormAlert />
        <SubmitButton variant={copy.variant} pendingLabel="Saving decision…">
          {copy.confirm}
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}
