import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ChipLink, Chips, EmptyState, PageHead, Pagination, PageSkeleton, surface } from "@/components/common";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import { formatDateTime } from "@/lib/format";
import type { AuditEntry, Page } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_otp": "Signed in with one-time code",
  "auth.register": "Registered an account",
  "auth.password_reset": "Reset password",
  "auth.password_changed": "Changed password",
  "application.submitted": "Submitted an application",
  "application.review_started": "Started an application review",
  "application.approve": "Approved an application",
  "application.reject": "Rejected an application",
  "application.request_changes": "Requested changes",
  "application.request_documents": "Requested documents",
  "alert.handled": "Took ownership of an alert",
  "alert.dismissed": "Dismissed an alert",
  "incident.resolved": "Resolved an incident",
  "police.duty": "Changed duty status",
  "user.created": "Created a staff account",
  "user.updated": "Updated a user",
};

async function AuditPageContent(props: PageProps<"/admin/audit">) {
  const params = await props.searchParams;
  const action = param(params, "action");
  const logs = await apiGet<Page<AuditEntry>>("/admin/audit-logs", { action, page: pageParam(params), size: 25 });
  const query = { action };

  return (
    <div>
      <PageHead title="Audit log" subtitle="Every sign-in, decision and change, newest first" back="/admin/more" />
      <Chips>
        <ChipLink basePath="/admin/audit" query={query} param="action" value={undefined} current={action}>
          Everything
        </ChipLink>
        <ChipLink basePath="/admin/audit" query={query} param="action" value="application." current={action}>
          Applications
        </ChipLink>
        <ChipLink basePath="/admin/audit" query={query} param="action" value="alert." current={action}>
          Alerts
        </ChipLink>
        <ChipLink basePath="/admin/audit" query={query} param="action" value="user." current={action}>
          Users
        </ChipLink>
        <ChipLink basePath="/admin/audit" query={query} param="action" value="auth." current={action}>
          Sign-ins
        </ChipLink>
      </Chips>
      {logs.items.length ? (
        <ol className={cn(surface, "mt-4 overflow-hidden")}>
          {logs.items.map((log) => (
            <li key={log.id} className="flex items-start justify-between gap-4 border-b px-4 py-3 last:border-b-0 md:px-5">
              <div className="min-w-0">
                <strong className="block text-sm font-medium">{ACTION_LABEL[log.action] ?? log.action}</strong>
                <span className="block truncate text-xs text-muted-foreground">
                  {log.actor_name ?? "System"}
                  {typeof log.meta.reference === "string" && (
                    <>
                      {" · "}
                      <span className="font-mono">{log.meta.reference}</span>
                    </>
                  )}
                </span>
              </div>
              <div className="shrink-0 text-right text-xs text-muted-foreground">
                {formatDateTime(log.created_at)}
                {log.ip_address && <div className="font-mono">{log.ip_address}</div>}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-4">
          <EmptyState icon={<ClipboardList />} title="Nothing recorded yet" />
        </div>
      )}
      <Pagination page={logs.page} pages={logs.pages} total={logs.total} basePath="/admin/audit" query={query} />
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function AuditPage(props: PageProps<"/admin/audit">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AuditPageContent {...props} />
    </Suspense>
  );
}
