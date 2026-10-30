import { Search, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { AlertRow } from "@/components/police";
import { ChipCount, ChipLink, Chips, Dot, EmptyState, FilterSelect, PageHead, Pagination, PageSkeleton, chipClass, surface } from "@/components/common";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelectOption } from "@/components/ui/native-select";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import type { Alert, AlertCounts, Page } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Parking alerts" };

const VIOLATIONS = [
  ["no_parking_zone", "No-parking zone"],
  ["restricted_lane", "Restricted lane parking"],
  ["near_intersection", "Parking near intersection"],
  ["footpath_obstruction", "Footpath obstruction"],
  ["double_parking", "Double parking"],
  ["bus_stop_obstruction", "Bus stop obstruction"],
  ["overtime_parking", "Overtime parking"],
  ["loading_zone_obstruction", "Loading zone obstruction"],
];

const WINDOWS: Record<string, number> = { "1h": 1, "24h": 24, "7d": 24 * 7 };

async function AlertsPageContent(props: PageProps<"/police/alerts">) {
  const params = await props.searchParams;
  const filters = {
    status: param(params, "status") ?? "open",
    severity: param(params, "severity"),
    area: param(params, "area"),
    violation_type: param(params, "violation_type"),
    window: param(params, "window"),
    camera_id: param(params, "camera_id"),
    q: param(params, "q"),
    sort: param(params, "sort") ?? "severity",
  };
  const [counts, areas, alerts] = await Promise.all([
    apiGet<AlertCounts>("/alerts/counts"),
    apiGet<string[]>("/alerts/areas"),
    apiGet<Page<Alert>>("/alerts", {
      ...filters,
      status: filters.status === "all" ? undefined : filters.status,
      window: undefined,
      within_hours: filters.window ? WINDOWS[filters.window] : undefined,
      page: pageParam(params),
      size: 15,
    }),
  ]);
  const chipQuery = { ...filters, severity: undefined };

  return (
    <>
      <PageHead title="Parking alerts" subtitle={`${counts.open} open across Kathmandu Valley · ${counts.high_priority} high priority`} back="/police" />

      <Chips label="Alert status">
        <ChipLink basePath="/police/alerts" query={chipQuery} param="status" value="open" current={filters.severity ? "" : filters.status} count={counts.open}>
          Open
        </ChipLink>
        <ChipLink basePath="/police/alerts" query={chipQuery} param="status" value="active" current={filters.severity ? "" : filters.status} count={counts.active}>
          Unassigned
        </ChipLink>
        <ChipLink basePath="/police/alerts" query={chipQuery} param="status" value="assigned" current={filters.severity ? "" : filters.status} count={counts.assigned}>
          Assigned
        </ChipLink>
        <Link
          className={chipClass}
          aria-current={filters.severity === "high" ? "true" : undefined}
          href={`/police/alerts?status=open&severity=high${filters.area ? `&area=${encodeURIComponent(filters.area)}` : ""}`}
        >
          <Dot className="bg-destructive" />
          High priority <ChipCount>{counts.high_priority}</ChipCount>
        </Link>
        <ChipLink basePath="/police/alerts" query={chipQuery} param="status" value="resolved" current={filters.severity ? "" : filters.status}>
          Resolved
        </ChipLink>
        <ChipLink basePath="/police/alerts" query={chipQuery} param="status" value="all" current={filters.severity ? "" : filters.status}>
          All history
        </ChipLink>
      </Chips>

      <form className={cn(surface, "mt-4 flex flex-col gap-3 p-4")} action="/police/alerts" role="search" aria-label="Filter alerts">
        <input type="hidden" name="status" value={filters.status} />
        {filters.severity && <input type="hidden" name="severity" value={filters.severity} />}
        {filters.camera_id && <input type="hidden" name="camera_id" value={filters.camera_id} />}
        <InputGroup>
          <InputGroupInput name="q" autoComplete="off" defaultValue={filters.q} placeholder="Search plate number, alert code or road" aria-label="Plate number or alert code" />
          <InputGroupAddon className="pl-3">
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <FilterSelect id="area" label="Location" defaultValue={filters.area ?? ""}>
            <NativeSelectOption value="">All areas</NativeSelectOption>
            {areas.map((a) => (
              <NativeSelectOption key={a} value={a}>
                {a}
              </NativeSelectOption>
            ))}
          </FilterSelect>
          <FilterSelect id="violation_type" label="Violation" defaultValue={filters.violation_type ?? ""}>
            <NativeSelectOption value="">All violations</NativeSelectOption>
            {VIOLATIONS.map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </FilterSelect>
          <FilterSelect id="window" label="Time" defaultValue={filters.window ?? ""}>
            <NativeSelectOption value="">Any time</NativeSelectOption>
            <NativeSelectOption value="1h">Last hour</NativeSelectOption>
            <NativeSelectOption value="24h">Last 24 hours</NativeSelectOption>
            <NativeSelectOption value="7d">Last 7 days</NativeSelectOption>
          </FilterSelect>
          <FilterSelect id="sort" label="Sort" defaultValue={filters.sort}>
            <NativeSelectOption value="severity">Priority first</NativeSelectOption>
            <NativeSelectOption value="newest">Newest first</NativeSelectOption>
            <NativeSelectOption value="oldest">Oldest first</NativeSelectOption>
          </FilterSelect>
          <Button type="submit" className="col-span-2 self-end md:col-span-1">
            Apply
          </Button>
        </div>
      </form>

      <div className="mt-4 flex flex-col gap-3">
        {alerts.items.length ? (
          alerts.items.map((a) => <AlertRow key={a.id} alert={a} />)
        ) : (
          <EmptyState icon={<TriangleAlert />} title="No alerts match these filters" body="Live detections appear here automatically while you are on duty." />
        )}
      </div>
      <Pagination page={alerts.page} pages={alerts.pages} total={alerts.total} basePath="/police/alerts" query={filters} />
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function AlertsPage(props: PageProps<"/police/alerts">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlertsPageContent {...props} />
    </Suspense>
  );
}
