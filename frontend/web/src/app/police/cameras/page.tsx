import { Cctv, Map, Search } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { Badge, CctvFeed, ChipLink, Chips, Dot, EmptyState, PageHead, Pagination, PageSkeleton, surfaceLink } from "@/components/common";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import { CAMERA_STATUS, formatClock } from "@/lib/format";
import type { Camera, CameraCounts, Page } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "CCTV cameras" };

async function CamerasPageContent(props: PageProps<"/police/cameras">) {
  const params = await props.searchParams;
  const filters = { q: param(params, "q"), status: param(params, "status") };
  const [counts, cameras] = await Promise.all([
    apiGet<CameraCounts>("/cameras/counts"),
    apiGet<Page<Camera>>("/cameras", { ...filters, page: pageParam(params), size: 12 }),
  ]);

  return (
    <>
      <PageHead
        title="CCTV cameras"
        subtitle={`${counts.total} cameras · ${counts.live} currently online`}
        back="/police"
        actions={
          <Button asChild variant="outline">
            <Link href="/police">
              <Map /> Map view
            </Link>
          </Button>
        }
      />
      <form role="search" action="/police/cameras" className="flex gap-2">
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        <InputGroup className="h-11 flex-1">
          <InputGroupInput name="q" autoComplete="off" defaultValue={filters.q} placeholder="Search camera ID, road or area" aria-label="Search cameras" />
          <InputGroupAddon className="pl-3">
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <Button type="submit" size="lg">
          Search
        </Button>
      </form>
      <Chips className="mt-4">
        <ChipLink basePath="/police/cameras" query={filters} param="status" value={undefined} current={filters.status} count={counts.total}>
          All
        </ChipLink>
        <ChipLink basePath="/police/cameras" query={filters} param="status" value="live" current={filters.status} count={counts.live}>
          <Dot className="bg-success" />
          Live
        </ChipLink>
        <ChipLink basePath="/police/cameras" query={filters} param="status" value="offline" current={filters.status} count={counts.offline}>
          <Dot className="bg-muted-foreground" />
          Offline
        </ChipLink>
        <ChipLink basePath="/police/cameras" query={filters} param="status" value="maintenance" current={filters.status} count={counts.maintenance}>
          <Dot className="bg-warning" />
          Maintenance
        </ChipLink>
      </Chips>

      {cameras.items.length ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cameras.items.map((camera) => (
            <Link key={camera.id} href={`/police/cameras/${camera.id}`} className={cn(surfaceLink, "group overflow-hidden p-1.5")}>
              <CctvFeed
                className="rounded-lg"
                label={camera.code}
                stamp={`${camera.code} · ${formatClock(camera.last_heartbeat_at)}`}
                offline={camera.status !== "live"}
                detection={camera.active_violations > 0 ? `${camera.active_violations} violation${camera.active_violations > 1 ? "s" : ""}` : undefined}
              />
              <div className="px-2.5 pt-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <strong className="font-mono text-sm font-medium">{camera.code}</strong>
                  <Badge tone={CAMERA_STATUS[camera.status].tone} live={camera.status === "live"}>
                    {CAMERA_STATUS[camera.status].label}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-sm">{camera.name}</p>
                <small className="mt-1 block text-xs text-muted-foreground">
                  {formatClock(camera.last_heartbeat_at)} · {camera.active_violations} active violation{camera.active_violations === 1 ? "" : "s"}
                </small>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-5">
          <EmptyState icon={<Cctv />} title="No cameras found" body="Try a different road name or camera ID." />
        </div>
      )}
      <Pagination page={cameras.page} pages={cameras.pages} total={cameras.total} basePath="/police/cameras" query={filters} />
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function CamerasPage(props: PageProps<"/police/cameras">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CamerasPageContent {...props} />
    </Suspense>
  );
}
