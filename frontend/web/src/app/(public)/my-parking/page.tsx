import { Plus, SquareParking } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ApplicationCard } from "@/components/parking";
import { ChipLink, Chips, EmptyState, PageHead, Pagination, SectionTitle, PageSkeleton, surface } from "@/components/common";
import { Button } from "@/components/ui/button";
import { createDraftAction } from "@/lib/actions/applications";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import type { ApplicationSummary, Page, StatusCounts } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My parking" };

function AddButton({ block }: { block?: boolean }) {
  return (
    <form action={createDraftAction}>
      <Button type="submit" size="lg" className={block ? "w-full" : undefined}>
        <Plus /> Add a parking location
      </Button>
    </form>
  );
}

function Summary({ value, label }: { value: number; label: string }) {
  return (
    <div className="px-4 py-4 md:px-5">
      <strong className="block font-heading text-3xl leading-none font-semibold tabular-nums">{value}</strong>
      <span className="mt-1.5 block text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

async function MyParkingPageContent(props: PageProps<"/my-parking">) {
  const params = await props.searchParams;
  const status = param(params, "status");
  const query = { status };
  const [counts, apps] = await Promise.all([
    apiGet<StatusCounts>("/applications/mine/counts"),
    apiGet<Page<ApplicationSummary>>("/applications/mine", { status, page: pageParam(params), size: 10 }),
  ]);

  return (
    <div>
      <PageHead
        title="My Parking"
        subtitle="Register your land and track government approval"
        actions={
          <span className="hidden md:block">
            <AddButton />
          </span>
        }
      />

      <div className={cn(surface, "grid grid-cols-2 md:grid-cols-4 [&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t md:[&>*:nth-child(n+2)]:border-l md:[&>*:nth-child(n+3)]:border-t-0")} aria-label="Application summary">
        <Summary value={counts.total} label="Applications" />
        <Summary value={counts.approved} label="Approved" />
        <Summary value={counts.pending} label="In review" />
        <Summary value={counts.changes_requested} label="Need changes" />
      </div>

      <Chips label="Filter by status" className="mt-6">
        <ChipLink basePath="/my-parking" query={query} param="status" value={undefined} current={status} count={counts.total}>
          All
        </ChipLink>
        <ChipLink basePath="/my-parking" query={query} param="status" value="pending" current={status} count={counts.pending}>
          In review
        </ChipLink>
        <ChipLink basePath="/my-parking" query={query} param="status" value="changes_requested" current={status} count={counts.changes_requested}>
          Changes requested
        </ChipLink>
        <ChipLink basePath="/my-parking" query={query} param="status" value="approved" current={status} count={counts.approved}>
          Approved
        </ChipLink>
        <ChipLink basePath="/my-parking" query={query} param="status" value="rejected" current={status} count={counts.rejected}>
          Rejected
        </ChipLink>
        <ChipLink basePath="/my-parking" query={query} param="status" value="draft" current={status} count={counts.draft}>
          Drafts
        </ChipLink>
      </Chips>

      <SectionTitle title="Your properties" />
      {apps.items.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {apps.items.map((app) => (
            <ApplicationCard
              key={app.id}
              app={app}
              href={app.status === "draft" ? `/my-parking/${app.id}/edit/${["location", "property", "owner", "documents", "review"][Math.min(app.completed_step, 4)]}` : `/my-parking/${app.id}`}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<SquareParking />}
          title={status ? "No applications with this status" : "You have not registered any land yet"}
          body="Turn unused private land into approved public parking. The application takes about 10 minutes."
        />
      )}
      <Pagination page={apps.page} pages={apps.pages} total={apps.total} basePath="/my-parking" query={query} />
      <div className="mt-6 md:hidden">
        <AddButton block />
      </div>
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function MyParkingPage(props: PageProps<"/my-parking">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MyParkingPageContent {...props} />
    </Suspense>
  );
}
