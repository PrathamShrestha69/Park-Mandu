import { Check, Clock } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { CopyButton } from "@/components/interactive";
import { Badge, Callout, PageSkeleton, surface } from "@/components/common";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import type { ApplicationDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Application submitted" };

async function SubmittedPageContent(props: PageProps<"/my-parking/[id]/submitted">) {
  const { id } = await props.params;
  const app = await apiGet<ApplicationDetail>(`/applications/${id}`);
  return (
    <div className="flex w-full max-w-3xl flex-col items-start">
      <span className="grid size-12 place-items-center rounded-xl bg-success text-white">
        <Check className="size-6" strokeWidth={2.5} />
      </span>
      <Badge tone="success" className="mt-6">
        Submission received
      </Badge>
      <h1 className="mt-3 text-2xl leading-tight font-semibold md:text-[2rem]">Application submitted</h1>
      <p className="mt-1 text-sm text-muted-foreground md:text-[0.9375rem]">Your parking location is now under government review.</p>

      <div className={cn(surface, "mt-8 flex w-full items-center justify-between gap-3 p-5")}>
        <div className="min-w-0">
          <span className="block text-xs text-muted-foreground">Application reference</span>
          <strong className="block truncate font-mono text-lg font-medium">{app.reference}</strong>
        </div>
        {app.reference && <CopyButton value={app.reference} />}
      </div>
      <Callout className="mt-3" icon={<Clock />} title="What happens next">
        A parking registration officer will review your property and documents. Review times vary with the number of applications; we
        will notify you when the status changes or if more information is needed.
      </Callout>
      <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row">
        <Button asChild size="lg">
          <Link href={`/my-parking/${app.id}`}>View application status</Link>
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link href="/home">Return to home</Link>
        </Button>
      </div>
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function SubmittedPage(props: PageProps<"/my-parking/[id]/submitted">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SubmittedPageContent {...props} />
    </Suspense>
  );
}
