import { ChevronRight, MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ProfileView } from "@/components/profile";
import { PageHead, PageSkeleton, surfaceLink } from "@/components/common";
import { cn } from "@/lib/utils";
import { getViewer } from "@/lib/dal";

export const metadata: Metadata = { title: "Profile" };

async function ProfilePageContent() {
  const user = await getViewer();
  return (
    <div>
      <PageHead title="Profile" subtitle="Account and preferences" />
      <Link href="/suggestions" className={cn(surfaceLink, "group mb-6 flex items-center gap-3 p-4")}>
        <MessagesSquare className="size-5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <strong className="block text-sm font-medium">Suggestion box</strong>
          <span className="block text-xs text-muted-foreground">Share an idea or feedback with the Park Mandu team</span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
      <ProfileView user={user} />
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function ProfilePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProfilePageContent />
    </Suspense>
  );
}
