import type { Metadata } from "next";
import { Suspense } from "react";

import { ProfileView } from "@/components/profile";
import { PageHead, PageSkeleton } from "@/components/common";
import { getViewer } from "@/lib/dal";

export const metadata: Metadata = { title: "Profile" };

async function ProfilePageContent() {
  const user = await getViewer();
  return (
    <div>
      <PageHead title="Profile" subtitle="Account and preferences" />
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
