import { FileText, Search } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ApplicationCard } from "@/components/parking";
import { ChipLink, Chips, EmptyState, FilterSelect, PageHead, Pagination, PageSkeleton, surface } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelectOption } from "@/components/ui/native-select";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import type { ApplicationSummary, Page, StatusCounts } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Parking applications" };

async function AdminApplicationsPageContent(props: PageProps<"/admin/applications">) {
  const params = await props.searchParams;
  const filters = {
    status: param(params, "status") ?? "pending",
    q: param(params, "q"),
    area: param(params, "area"),
    submitted_from: param(params, "submitted_from"),
    submitted_to: param(params, "submitted_to"),
    sort: param(params, "sort"),
  };
  const [counts, areas, apps] = await Promise.all([
    apiGet<StatusCounts>("/admin/applications/counts"),
    apiGet<string[]>("/parkings/areas"),
    apiGet<Page<ApplicationSummary>>("/admin/applications", {
      ...filters,
      status: filters.status === "all" ? undefined : filters.status,
      page: pageParam(params),
      size: 12,
    }),
  ]);

  return (
    <>
      <PageHead title="Parking applications" subtitle={`${counts.pending} applications awaiting action`} back="/admin" />
      <Chips>
        <ChipLink basePath="/admin/applications" query={filters} param="status" value="pending" current={filters.status} count={counts.pending}>
          Pending
        </ChipLink>
        <ChipLink basePath="/admin/applications" query={filters} param="status" value="submitted" current={filters.status}>
          New
        </ChipLink>
        <ChipLink basePath="/admin/applications" query={filters} param="status" value="under_review" current={filters.status}>
          In review
        </ChipLink>
        <ChipLink basePath="/admin/applications" query={filters} param="status" value="changes_requested" current={filters.status} count={counts.changes_requested}>
          Changes requested
        </ChipLink>
        <ChipLink basePath="/admin/applications" query={filters} param="status" value="approved" current={filters.status} count={counts.approved}>
          Approved
        </ChipLink>
        <ChipLink basePath="/admin/applications" query={filters} param="status" value="rejected" current={filters.status} count={counts.rejected}>
          Rejected
        </ChipLink>
        <ChipLink basePath="/admin/applications" query={filters} param="status" value="all" current={filters.status} count={counts.total}>
          All
        </ChipLink>
      </Chips>

      <form className={cn(surface, "mt-4 flex flex-col gap-3 p-4")} role="search" action="/admin/applications">
        <input type="hidden" name="status" value={filters.status} />
        <InputGroup>
          <InputGroupInput name="q" autoComplete="off" defaultValue={filters.q} placeholder="Search reference, applicant, property or address" aria-label="Search applications" />
          <InputGroupAddon className="pl-3">
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <FilterSelect id="area" label="Area" defaultValue={filters.area ?? ""}>
            <NativeSelectOption value="">All areas</NativeSelectOption>
            {areas.map((a) => (
              <NativeSelectOption key={a} value={a}>
                {a}
              </NativeSelectOption>
            ))}
          </FilterSelect>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="submitted_from" className="text-xs font-medium text-muted-foreground">
              Submitted from
            </label>
            <Input id="submitted_from" type="date" name="submitted_from" defaultValue={filters.submitted_from} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="submitted_to" className="text-xs font-medium text-muted-foreground">
              Submitted to
            </label>
            <Input id="submitted_to" type="date" name="submitted_to" defaultValue={filters.submitted_to} />
          </div>
          <FilterSelect id="sort" label="Sort" defaultValue={filters.sort ?? "newest"}>
            <NativeSelectOption value="newest">Newest first</NativeSelectOption>
            <NativeSelectOption value="oldest">Waiting longest</NativeSelectOption>
            <NativeSelectOption value="capacity">Largest capacity</NativeSelectOption>
          </FilterSelect>
          <Button type="submit" className="col-span-2 self-end md:col-span-1">
            Apply
          </Button>
        </div>
      </form>

      {apps.items.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {apps.items.map((app) => (
            <ApplicationCard key={app.id} app={app} href={`/admin/applications/${app.id}`} showApplicant />
          ))}
        </div>
      ) : (
        <div className="mt-4">
          <EmptyState icon={<FileText />} title="No applications match" body="Change the status tab or clear the filters." />
        </div>
      )}
      <Pagination page={apps.page} pages={apps.pages} total={apps.total} basePath="/admin/applications" query={filters} />
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function AdminApplicationsPage(props: PageProps<"/admin/applications">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminApplicationsPageContent {...props} />
    </Suspense>
  );
}
