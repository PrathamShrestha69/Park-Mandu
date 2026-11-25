import { Trash2 } from "lucide-react";

import { SubmitButton } from "@/components/forms";
import { Dialog } from "@/components/interactive";
import { deleteDraftAction } from "@/lib/actions/applications";

/** "Delete draft" button for an unsubmitted parking application; asks before deleting. */
export function DeleteDraft({ applicationId, name, className }: { applicationId: string; name: string | null; className?: string }) {
  return (
    <Dialog
      trigger={
        <>
          <Trash2 /> Delete draft
        </>
      }
      triggerVariant="ghost"
      triggerClassName={`text-destructive hover:bg-destructive/10 hover:text-destructive ${className ?? ""}`}
      icon={<Trash2 />}
      title="Delete this draft?"
      description={`${name ?? "This untitled parking location"} and its uploaded documents will be removed. This cannot be undone.`}
    >
      <form action={deleteDraftAction}>
        <input type="hidden" name="application_id" value={applicationId} />
        <SubmitButton variant="danger" pendingLabel="Deleting…" icon={<Trash2 />}>
          Delete draft
        </SubmitButton>
      </form>
    </Dialog>
  );
}
