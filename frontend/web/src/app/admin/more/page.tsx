import { ChevronRight, ClipboardList, Map, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { ProfileView, menuRow } from "@/components/profile";
import { PageHead, PageSkeleton, surface } from "@/components/common";
import { getViewer } from "@/lib/dal";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "More" };

async function AdminMorePageContent() {
  const user = await getViewer();
  const links = [
    { href: "/admin/audit", icon: <ClipboardList />, label: "Audit log" },
    { href: "/admin/users/new", icon: <UserPlus />, label: "Add staff account" },
    { href: "/admin/map", icon: <Map />, label: "Valley-wide map" },
  ];
  return (
    <div>
      <PageHead title="More" subtitle="Administration & settings" />
      <ProfileView
        user={user}
        extra={
          <nav className={cn(surface, "overflow-hidden")} aria-label="Administration">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={cn(menuRow, "border-b last:border-b-0")}>
                <span className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">{l.icon}</span>
                  {l.label}
                </span>
                <ChevronRight className="text-muted-foreground" />
              </Link>
            ))}
          </nav>
        }
      />
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function AdminMorePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminMorePageContent />
    </Suspense>
  );
}
