import { Search, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AutoSubmitSelect, LocateMe } from "@/components/interactive";
import { ExploreMap, PlaceSearch } from "@/components/explore-location";
import { ParkingRow, parkingsToPoints } from "@/components/parking";
import { ChipLink, Chips, Dot, EmptyState, PageHead, Pagination, PageSkeleton, chipClass } from "@/components/common";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import { VEHICLE_TYPES, VEHICLE_TYPE_LABEL } from "@/lib/format";
import type { Page, ParkingSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Find parking" };

async function ExplorePageContent(props: PageProps<"/explore">) {
  const params = await props.searchParams;
  const filters = {
    q: param(params, "q"),
    category: param(params, "category"),
    vehicle_type: param(params, "vehicle_type"),
    free_only: param(params, "free_only") === "true" ? "true" : undefined,
    available_only: param(params, "available_only") === "true" ? "true" : undefined,
    open_now: param(params, "open_now") === "true" ? "true" : undefined,
    sort: param(params, "sort"),
    lat: param(params, "lat"),
    lng: param(params, "lng"),
    place: param(params, "place"),
  };
  const page = pageParam(params);
  const hasOrigin = Boolean(filters.lat && filters.lng);
  // Default order: parking that can be used right now first, nearest first when the position is known.
  const sort = filters.sort ?? "recommended";

  const { place, ...apiFilters } = filters;
  const results = await apiGet<Page<ParkingSummary>>("/parkings", {
    ...apiFilters,
    sort,
    // A chosen place means "near here"; the device's own position searches the wider valley.
    radius_m: hasOrigin ? (place ? 5_000 : 20_000) : undefined,
    page,
    size: 10,
  });
  const locationQuery = hasOrigin ? `?lat=${filters.lat}&lng=${filters.lng}` : "";
  const origin = hasOrigin ? { latitude: Number(filters.lat), longitude: Number(filters.lng) } : null;
  const picked = origin && place ? { ...origin, label: place } : null;

  return (
    <>
      <PageHead
        title="Find parking"
        subtitle={
          place
            ? `Parking within 5 km of ${place}, nearest first`
            : hasOrigin
              ? "Sorted from your location · distances shown on each result"
              : "Verified public and private parking across the valley"
        }
        actions={<LocateMe label={hasOrigin ? "Update location" : "Use my location"} askOnce />}
      />

      <div className="mb-3">
        <PlaceSearch place={place} />
      </div>

      <form className="flex flex-col gap-3" role="search" action="/explore">
        {place && <input type="hidden" name="place" value={place} />}
        {filters.lat && <input type="hidden" name="lat" value={filters.lat} />}
        {filters.lng && <input type="hidden" name="lng" value={filters.lng} />}
        {filters.category && <input type="hidden" name="category" value={filters.category} />}
        {filters.vehicle_type && <input type="hidden" name="vehicle_type" value={filters.vehicle_type} />}
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
            <input type="checkbox" name="open_now" value="true" defaultChecked={!!filters.open_now} className="sr-only" />
            Open now
          </label>
          <label className={cn(chipClass, "cursor-pointer has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring")}>
            <input type="checkbox" name="free_only" value="true" defaultChecked={!!filters.free_only} className="sr-only" />
            Free only
          </label>
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            <AutoSubmitSelect name="sort" defaultValue={sort} aria-label="Sort by" size="sm" className="[&_select]:h-9 [&_select]:rounded-full">
              <option value="recommended">{hasOrigin ? "Nearest available" : "Available first"}</option>
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

      <Chips label="Vehicle type" className="mt-2">
        <ChipLink basePath="/explore" query={filters} param="vehicle_type" value={undefined} current={filters.vehicle_type}>
          Any vehicle
        </ChipLink>
        {VEHICLE_TYPES.map((type) => (
          <ChipLink key={type} basePath="/explore" query={filters} param="vehicle_type" value={type} current={filters.vehicle_type}>
            {VEHICLE_TYPE_LABEL[type]}
          </ChipLink>
        ))}
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
          <ExploreMap points={parkingsToPoints(results.items)} me={picked ? null : origin} picked={picked} />
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
