import { Search, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AutoSubmitSelect, LocateMe } from "@/components/interactive";
import { MapView } from "@/components/map/map-view";
import { ParkingRow, parkingsToPoints } from "@/components/parking";
import { ChipLink, Chips, Dot, EmptyState, PageHead, Pagination, PageSkeleton, chipClass } from "@/components/common";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import type { Page, ParkingSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Find parking" };

async function ExplorePageContent(props: PageProps<"/explore">) {
  const params = await props.searchParams;
  const filters = {
    q: param(params, "q"),
    category: param(params, "category"),
    free_only: param(params, "free_only") === "true" ? "true" : undefined,
    available_only: param(params, "available_only") === "true" ? "true" : undefined,
    sort: param(params, "sort"),
    lat: param(params, "lat"),
    lng: param(params, "lng"),
  };
  const page = pageParam(params);
  const hasOrigin = Boolean(filters.lat && filters.lng);
  const sort = filters.sort ?? (hasOrigin ? "distance" : "name");

  const results = await apiGet<Page<ParkingSummary>>("/parkings", {
    ...filters,
    sort,
    radius_m: hasOrigin ? 20_000 : undefined,
    page,
    size: 10,
  });
  const locationQuery = hasOrigin ? `?lat=${filters.lat}&lng=${filters.lng}` : "";
  const me = hasOrigin ? { latitude: Number(filters.lat), longitude: Number(filters.lng) } : null;

  return (
    <>
      <PageHead title="Find parking" subtitle="Verified public and private parking across the valley" actions={<LocateMe />} />

      <form className="flex flex-col gap-3" role="search" action="/explore">
        {filters.lat && <input type="hidden" name="lat" value={filters.lat} />}
        {filters.lng && <input type="hidden" name="lng" value={filters.lng} />}
        {filters.category && <input type="hidden" name="category" value={filters.category} />}
        <div className="flex gap-2">
          <InputGroup className="h-11 flex-1">
            <InputGroupInput name="q" autoComplete="off" defaultValue={filters.q} placeholder="Search by name, street or area (e.g. Thamel)" aria-label="Search parking" />
            <InputGroupAddon className="pl-3">
              <Search />
            </InputGroupAddon>
          </InputGroup>
          <Button type="submit" size="lg">
            Search
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className={cn(chipClass, "cursor-pointer has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring")}>
            <input type="checkbox" name="available_only" value="true" defaultChecked={!!filters.available_only} className="sr-only" />
            Spaces available
          </label>
          <label className={cn(chipClass, "cursor-pointer has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring")}>
            <input type="checkbox" name="free_only" value="true" defaultChecked={!!filters.free_only} className="sr-only" />
            Free only
          </label>
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            <AutoSubmitSelect name="sort" defaultValue={sort} aria-label="Sort by" size="sm" className="[&_select]:h-9 [&_select]:rounded-full">
              {hasOrigin && <option value="distance">Nearest first</option>}
              <option value="name">Name A–Z</option>
              <option value="available">Most spaces</option>
              <option value="price">Lowest price</option>
            </AutoSubmitSelect>
          </span>
          <Button type="submit" variant="ghost" size="sm" className="h-9">
            Apply
          </Button>
        </div>
      </form>

      <Chips label="Parking type" className="mt-4 border-t pt-4">
        <ChipLink basePath="/explore" query={filters} param="category" value={undefined} current={filters.category}>
          All parking
        </ChipLink>
        <ChipLink basePath="/explore" query={filters} param="category" value="government" current={filters.category}>
          <Dot className="bg-info" />
          Government / public
        </ChipLink>
        <ChipLink basePath="/explore" query={filters} param="category" value="private" current={filters.category}>
          <Dot className="bg-success" />
          Approved private
        </ChipLink>
      </Chips>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <section aria-label="Results">
          {results.items.length ? (
            <div className="flex flex-col gap-3">
              {results.items.map((p) => (
                <ParkingRow key={p.id} parking={p} href={`/parking/${p.id}${locationQuery}`} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Search />}
              title="No parking matches your search"
              body="Try a nearby area, remove a filter, or search without a keyword."
            />
          )}
          <Pagination page={results.page} pages={results.pages} total={results.total} basePath="/explore" query={filters} />
        </section>
        <div className="order-first lg:sticky lg:top-6 lg:order-none">
          <MapView points={parkingsToPoints(results.items)} me={me} label="Map of search results" />
        </div>
      </div>
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function ExplorePage(props: PageProps<"/explore">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ExplorePageContent {...props} />
    </Suspense>
  );
}
