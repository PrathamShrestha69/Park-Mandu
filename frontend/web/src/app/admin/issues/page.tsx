import { ExternalLink, MapPin, MessageSquareWarning, Search } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Badge, ChipLink, Chips, Dot, EmptyState, PageHead, Pagination, PageSkeleton, surface } from "@/components/common";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { setIssueStatusAction } from "@/lib/actions/operations";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import { formatDateTime, timeAgo } from "@/lib/format";
import type { IssueCategory, IssueCounts, IssueReport, IssueStatus, Page, Tone } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Issue reports" };

const CATEGORY_LABEL: Record<IssueCategory, string> = {
  wrong_information: "Wrong information",
  closed_or_full: "Closed or full",
  overcharging: "Overcharging",
  safety: "Safety",
  other: "Other",
};

const STATUS: Record<IssueStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "warning" },
  reviewed: { label: "Reviewed", tone: "info" },
  closed: { label: "Closed", tone: "success" },
};

/** The next steps an administrator can take from each status. */
const NEXT: Record<IssueStatus, { status: IssueStatus; label: string; primary?: boolean }[]> = {
  open: [
    { status: "reviewed", label: "Mark reviewed", primary: true },
    { status: "closed", label: "Close" },
  ],
  reviewed: [
    { status: "closed", label: "Close", primary: true },
    { status: "open", label: "Reopen" },
  ],
  closed: [{ status: "open", label: "Reopen" }],
};

function IssueActions({ issue }: { issue: IssueReport }) {
  return (
    <div className="flex flex-wrap gap-2">
      {NEXT[issue.status].map((step) => (
        <form key={step.status} action={setIssueStatusAction}>
          <input type="hidden" name="issue_id" value={issue.id} />
          <input type="hidden" name="status" value={step.status} />
          <Button type="submit" size="sm" variant={step.primary ? "default" : "outline"}>
            {step.label}
          </Button>
        </form>
      ))}
    </div>
  );
}

async function IssuesPageContent(props: PageProps<"/admin/issues">) {
  const params = await props.searchParams;
  const filters = {
    q: param(params, "q"),
    status: param(params, "status"),
    category: param(params, "category"),
    sort: param(params, "sort"),
  };
  const [counts, issues] = await Promise.all([
    apiGet<IssueCounts>("/admin/issues/counts"),
    apiGet<Page<IssueReport>>("/admin/issues", { ...filters, page: pageParam(params), size: 15 }),
  ]);

  return (
    <>
      <PageHead title="Issue reports" subtitle={`${counts.total.toLocaleString()} reports from the public · ${counts.open} open`} back="/admin" />

      <form role="search" action="/admin/issues" className="flex flex-wrap gap-2">
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        <InputGroup className="h-10 min-w-56 flex-1">
          <InputGroupInput name="q" autoComplete="off" defaultValue={filters.q} placeholder="Search parking, area, reporter or description" aria-label="Search issue reports" />
          <InputGroupAddon className="pl-3">
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <NativeSelect name="category" defaultValue={filters.category ?? ""} aria-label="Category">
          <NativeSelectOption value="">Any category</NativeSelectOption>
          {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="sort" defaultValue={filters.sort ?? "newest"} aria-label="Sort by">
          <NativeSelectOption value="newest">Newest first</NativeSelectOption>
          <NativeSelectOption value="oldest">Oldest first</NativeSelectOption>
        </NativeSelect>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <Chips className="mt-4" label="Report status">
        <ChipLink basePath="/admin/issues" query={filters} param="status" value={undefined} current={filters.status} count={counts.total}>
          All
        </ChipLink>
        <ChipLink basePath="/admin/issues" query={filters} param="status" value="open" current={filters.status} count={counts.open}>
          <Dot className="bg-warning" />
          Open
        </ChipLink>
        <ChipLink basePath="/admin/issues" query={filters} param="status" value="reviewed" current={filters.status} count={counts.reviewed}>
          <Dot className="bg-info" />
          Reviewed
        </ChipLink>
        <ChipLink basePath="/admin/issues" query={filters} param="status" value="closed" current={filters.status} count={counts.closed}>
          <Dot className="bg-success" />
          Closed
        </ChipLink>
      </Chips>

      {issues.items.length ? (
        <ul className="mt-4 flex flex-col gap-3">
          {issues.items.map((issue) => (
            <li key={issue.id} className={cn(surface, "p-4 md:p-5")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={STATUS[issue.status].tone}>{STATUS[issue.status].label}</Badge>
                  <Badge>{CATEGORY_LABEL[issue.category]}</Badge>
                </span>
                <time dateTime={issue.created_at} className="text-xs text-muted-foreground" title={formatDateTime(issue.created_at)}>
                  Reported {timeAgo(issue.created_at).toLowerCase()} · {formatDateTime(issue.created_at)}
                </time>
              </div>

              <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <h2 className="font-sans text-[0.9375rem] font-semibold tracking-normal">{issue.parking.name}</h2>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-muted-foreground">
                    <MapPin className="size-3.5 shrink-0" /> {issue.parking.address} · {issue.parking.area}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${issue.parking.latitude},${issue.parking.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      Open location <ExternalLink className="size-3" />
                    </a>
                  </p>
                  <p className="mt-3 text-sm whitespace-pre-line">{issue.description}</p>
                </div>
                <div className="flex flex-col justify-between gap-3 lg:items-end lg:text-right">
                  <div className="text-[0.8125rem]">
                    <span className="block text-xs text-muted-foreground">Reported by</span>
                    <strong className="block font-medium">{issue.reporter.full_name}</strong>
                    <span className="block text-muted-foreground">{[issue.reporter.phone, issue.reporter.email].filter(Boolean).join(" · ") || "No contact details"}</span>
                    {issue.updated_at !== issue.created_at && (
                      <span className="mt-1 block text-xs text-muted-foreground">Last updated {timeAgo(issue.updated_at).toLowerCase()}</span>
                    )}
                  </div>
                  <IssueActions issue={issue} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4">
          <EmptyState
            icon={<MessageSquareWarning />}
            title="No issue reports"
            body={filters.q || filters.status || filters.category ? "No report matches these filters." : "Reports from the public appear here as soon as they are sent."}
          />
        </div>
      )}
      <Pagination page={issues.page} pages={issues.pages} total={issues.total} basePath="/admin/issues" query={filters} />
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function IssuesPage(props: PageProps<"/admin/issues">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <IssuesPageContent {...props} />
    </Suspense>
  );
}
