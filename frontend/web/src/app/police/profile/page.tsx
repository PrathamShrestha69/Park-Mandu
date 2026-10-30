import type { Metadata } from "next";
import { Suspense } from "react";

import { ProfileView } from "@/components/profile";
import { PageHead, PageSkeleton, surface } from "@/components/common";
import { DutyToggle } from "@/components/police";
import { getViewer } from "@/lib/dal";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Profile" };

async function PoliceProfilePageContent() {
  const user = await getViewer();
  return (
    <div>
      <PageHead title="Profile" subtitle="Duty status and account" />
      <ProfileView
        user={user}
        extra={
          <section className={cn(surface, "flex items-center justify-between gap-4 p-4")}>
            <div>
              <strong className="block text-sm font-semibold">Duty status</strong>
              <p className="text-[0.8125rem] text-muted-foreground">{user.on_duty ? "You are receiving live alerts." : "You are off duty."}</p>
            </div>
            <DutyToggle onDuty={user.on_duty} />
          </section>
        }
      />
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function PoliceProfilePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PoliceProfilePageContent />
    </Suspense>
  );
}
