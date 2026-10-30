import { Bell, CheckCheck, CircleCheck, Clock, FileText, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ChipLink, Chips, EmptyState, PageHead, Pagination, PageSkeleton, surface } from "@/components/common";
import { TONE_TILE } from "@/components/parking";
import { Button } from "@/components/ui/button";
import { markAllReadAction, openNotificationAction } from "@/lib/actions/applications";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import { timeAgo } from "@/lib/format";
import type { Notification, Page } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

const ICON: Record<Notification["tone"], React.ReactNode> = {
  info: <FileText />,
  success: <CircleCheck />,
  warning: <Clock />,
  danger: <TriangleAlert />,
};

function linkFor(n: Notification): string {
  if (n.entity_type === "application" && n.entity_id) return `/my-parking/${n.entity_id}`;
  return "";
}

async function NotificationsPageContent(props: PageProps<"/notifications">) {
  const params = await props.searchParams;
  const filter = param(params, "filter");
  const [notifications, unread] = await Promise.all([
    apiGet<Page<Notification>>("/notifications", { unread_only: filter === "unread", page: pageParam(params), size: 15 }),
    apiGet<{ unread: number }>("/notifications/unread-count"),
  ]);
  const query = { filter };

  return (
    <div>
      <PageHead
        title="Notifications"
        subtitle="Updates about your Park Mandu services"
        actions={
          unread.unread > 0 && (
            <form action={markAllReadAction}>
              <Button type="submit" variant="outline" size="sm">
                <CheckCheck /> Mark all read
              </Button>
            </form>
          )
        }
      />
      <Chips>
        <ChipLink basePath="/notifications" query={query} param="filter" value={undefined} current={filter}>
          All
        </ChipLink>
        <ChipLink basePath="/notifications" query={query} param="filter" value="unread" current={filter} count={unread.unread}>
          Unread
        </ChipLink>
      </Chips>

      {notifications.items.length ? (
        <ul className={cn(surface, "mt-4 overflow-hidden")}>
          {notifications.items.map((n) => (
            <li key={n.id} className="border-b last:border-b-0">
              <form action={openNotificationAction}>
                <input type="hidden" name="notification_id" value={n.id} />
                <input type="hidden" name="href" value={linkFor(n)} />
                <button
                  type="submit"
                  className={cn(
                    "flex w-full items-start gap-3.5 px-4 py-4 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none md:px-5",
                    !n.read_at && "bg-brand/[0.035]",
                  )}
                  aria-label={`${n.read_at ? "" : "Unread: "}${n.title}`}
                >
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg [&_svg]:size-[18px]", TONE_TILE[n.tone])}>{ICON[n.tone]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <strong className={cn("text-sm", n.read_at ? "font-medium" : "font-semibold")}>{n.title}</strong>
                      <small className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.created_at)}</small>
                    </span>
                    <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-muted-foreground">{n.body}</span>
                  </span>
                  {!n.read_at && <i className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-hidden />}
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4">
          <EmptyState
            icon={<Bell />}
            title={filter === "unread" ? "You're all caught up" : "No notifications yet"}
            body="We'll let you know here when there is news about your parking applications."
          />
        </div>
      )}
      <Pagination page={notifications.page} pages={notifications.pages} total={notifications.total} basePath="/notifications" query={query} />
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function NotificationsPage(props: PageProps<"/notifications">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NotificationsPageContent {...props} />
    </Suspense>
  );
}
