import { Search, Siren } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { IncidentRow } from "@/components/police";
import { ChipLink, Chips, EmptyState, PageHead, Pagination, PageSkeleton, chipClass } from "@/components/common";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { apiGet } from "@/lib/api";
import { buildQuery, pageParam, param } from "@/lib/api-query";
import type { IncidentSummary, Page } from "@/lib/types";

export const metadata: Metadata = { title: "Incidents" };

async function IncidentsPageContent(props: PageProps<"/police/incidents">) {
  const params = await props.searchParams;
  const filters = {
    status: param(params, "status") ?? "in_progress",
    mine: param(params, "mine") === "true" ? "true" : undefined,
    q: param(params, "q"),
  };
  const incidents = await apiGet<Page<IncidentSummary>>("/incidents", {
    ...filters,
    status: filters.status === "all" ? undefined : filters.status,
    page: pageParam(params),
    size: 15,
  });

  return (
    <>
      <PageHead title="Incidents" subtitle="Alerts that an officer has taken ownership of" back="/police" />
      <form role="search" action="/police/incidents">
        <input type="hidden" name="status" value={filters.status} />
        {filters.mine && <input type="hidden" name="mine" value="true" />}
        <InputGroup className="h-11">
          <InputGroupInput name="q" autoComplete="off" defaultValue={filters.q} placeholder="Search incident code or plate number" aria-label="Search incidents" />
          <InputGroupAddon className="pl-3">
            <Search />
          </InputGroupAddon>
        </InputGroup>
      </form>
      <Chips className="mt-4">
        <ChipLink basePath="/police/incidents" query={filters} param="status" value="in_progress" current={filters.status}>
          In progress
        </ChipLink>
        <ChipLink basePath="/police/incidents" query={filters} param="status" value="resolved" current={filters.status}>
          Resolved
        </ChipLink>
        <ChipLink basePath="/police/incidents" query={filters} param="status" value="all" current={filters.status}>
          All
        </ChipLink>
        <span className="mx-1 w-px shrink-0 self-stretch bg-border" aria-hidden />
        <Link
          className={chipClass}
          aria-pressed={!!filters.mine}
          href={`/police/incidents${buildQuery({ ...filters, mine: filters.mine ? undefined : "true" })}`}
        >
          Assigned to me
        </Link>
      </Chips>
      <div className="mt-4 flex flex-col gap-3">
        {incidents.items.length ? (
          incidents.items.map((i) => <IncidentRow key={i.id} incident={i} />)
        ) : (
          <EmptyState icon={<Siren />} title="No incidents here" body="Take ownership of an alert to open an incident." />
        )}
      </div>
      <Pagination page={incidents.page} pages={incidents.pages} total={incidents.total} basePath="/police/incidents" query={filters} />
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function IncidentsPage(props: PageProps<"/police/incidents">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <IncidentsPageContent {...props} />
    </Suspense>
  );
}
