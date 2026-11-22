import { MessagesSquare, Search, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Badge, ChipLink, Chips, Dot, EmptyState, PageHead, Pagination, PageSkeleton, surface } from "@/components/common";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { deleteSuggestionAction, updateSuggestionAction } from "@/lib/actions/operations";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import { SUGGESTION_CATEGORY, SUGGESTION_STATUS, formatDateTime, timeAgo } from "@/lib/format";
import type { Page, SuggestionAdmin, SuggestionCounts, SuggestionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Suggestions" };

const NEXT: Record<SuggestionStatus, { status: SuggestionStatus; label: string; primary?: boolean }[]> = {
  new: [
    { status: "reviewed", label: "Mark reviewed", primary: true },
    { status: "archived", label: "Archive" },
  ],
  reviewed: [
    { status: "resolved", label: "Mark acted on", primary: true },
    { status: "archived", label: "Archive" },
  ],
  resolved: [{ status: "archived", label: "Archive" }],
  archived: [{ status: "new", label: "Restore" }],
};

function SuggestionCard({ s }: { s: SuggestionAdmin }) {
  return (
    <li className={cn(surface, "p-4 md:p-5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={SUGGESTION_STATUS[s.status].tone}>{SUGGESTION_STATUS[s.status].label}</Badge>
          <Badge>{SUGGESTION_CATEGORY[s.category]}</Badge>
        </span>
        <time dateTime={s.created_at} className="text-xs text-muted-foreground" title={formatDateTime(s.created_at)}>
          Sent {timeAgo(s.created_at).toLowerCase()}
        </time>
      </div>
      <p className="mt-3 text-sm whitespace-pre-line">{s.message}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        From {s.author_name ?? "a deleted account"}
        {s.author_contact ? ` · ${s.author_contact}` : ""}
      </p>
      <div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <form action={updateSuggestionAction} className="flex gap-2">
          <input type="hidden" name="suggestion_id" value={s.id} />
          <InputGroup className="h-9">
            <InputGroupInput name="admin_note" defaultValue={s.admin_note ?? ""} maxLength={500} placeholder="Internal note (only admins see this)" aria-label="Internal note" />
          </InputGroup>
          <Button type="submit" size="sm" variant="outline" className="h-9">
            Save note
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {NEXT[s.status].map((step) => (
            <form key={step.status} action={updateSuggestionAction}>
              <input type="hidden" name="suggestion_id" value={s.id} />
              <input type="hidden" name="status" value={step.status} />
              <Button type="submit" size="sm" variant={step.primary ? "default" : "outline"}>
                {step.label}
              </Button>
            </form>
          ))}
          <form action={deleteSuggestionAction}>
            <input type="hidden" name="suggestion_id" value={s.id} />
            <Button type="submit" size="sm" variant="ghost" aria-label="Delete suggestion" title="Delete (spam)">
              <Trash2 />
            </Button>
          </form>
        </div>
      </div>
    </li>
  );
}

async function SuggestionsPageContent(props: PageProps<"/admin/suggestions">) {
  const params = await props.searchParams;
  const filters = { q: param(params, "q"), status: param(params, "status"), category: param(params, "category"), sort: param(params, "sort") };
  const [counts, page] = await Promise.all([
    apiGet<SuggestionCounts>("/admin/suggestions/counts"),
    apiGet<Page<SuggestionAdmin>>("/admin/suggestions", { ...filters, page: pageParam(params), size: 15 }),
  ]);

  return (
    <>
      <PageHead title="Suggestions" subtitle={`${counts.total.toLocaleString()} from the public · ${counts.new} new`} back="/admin" />
      <form role="search" action="/admin/suggestions" className="flex flex-wrap gap-2">
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        <InputGroup className="h-10 min-w-56 flex-1">
          <InputGroupInput name="q" autoComplete="off" defaultValue={filters.q} placeholder="Search suggestions" aria-label="Search suggestions" />
          <InputGroupAddon className="pl-3">
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <NativeSelect name="category" defaultValue={filters.category ?? ""} aria-label="Topic">
          <NativeSelectOption value="">Any topic</NativeSelectOption>
          {Object.entries(SUGGESTION_CATEGORY).map(([value, label]) => (
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

      <Chips className="mt-4" label="Suggestion status">
        <ChipLink basePath="/admin/suggestions" query={filters} param="status" value={undefined} current={filters.status} count={counts.total}>
          All
        </ChipLink>
        {(["new", "reviewed", "resolved", "archived"] as const).map((status) => (
          <ChipLink key={status} basePath="/admin/suggestions" query={filters} param="status" value={status} current={filters.status} count={counts[status]}>
            <Dot className={{ new: "bg-warning", reviewed: "bg-info", resolved: "bg-success", archived: "bg-muted-foreground" }[status]} />
            {SUGGESTION_STATUS[status].label}
          </ChipLink>
        ))}
      </Chips>

      {page.items.length ? (
        <ul className="mt-4 flex flex-col gap-3">
          {page.items.map((s) => (
            <SuggestionCard key={s.id} s={s} />
          ))}
        </ul>
      ) : (
        <div className="mt-4">
          <EmptyState
            icon={<MessagesSquare />}
            title="No suggestions"
            body={filters.q || filters.status || filters.category ? "No suggestion matches these filters." : "Suggestions from the public appear here as soon as they are sent."}
          />
        </div>
      )}
      <Pagination page={page.page} pages={page.pages} total={page.total} basePath="/admin/suggestions" query={filters} />
    </>
  );
}

export default function AdminSuggestionsPage(props: PageProps<"/admin/suggestions">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SuggestionsPageContent {...props} />
    </Suspense>
  );
}
