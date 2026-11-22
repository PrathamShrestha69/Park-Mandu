import { ChevronRight, Ticket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Badge, ChipLink, Chips, EmptyState, PageHead, Pagination, PageSkeleton, surfaceLink } from "@/components/common";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import { pageParam, param } from "@/lib/api-query";
import { BOOKING_STATUS, formatDateTime, formatRupees } from "@/lib/format";
import type { BookingSummary, Page } from "@/lib/types";

export const metadata: Metadata = { title: "My bookings" };

async function BookingsContent(props: PageProps<"/bookings">) {
  const params = await props.searchParams;
  const scope = param(params, "scope");
  const bookings = await apiGet<Page<BookingSummary>>("/bookings", { scope, page: pageParam(params), size: 10 });
  const query = { scope };
  return (
    <div>
      <PageHead title="My bookings" subtitle="Paid parking you booked with eSewa or Khalti" />
      <Chips label="Show" className="mb-4">
        <ChipLink basePath="/bookings" query={query} param="scope" value={undefined} current={scope}>
          All
        </ChipLink>
        <ChipLink basePath="/bookings" query={query} param="scope" value="active" current={scope}>
          Active
        </ChipLink>
        <ChipLink basePath="/bookings" query={query} param="scope" value="past" current={scope}>
          Past
        </ChipLink>
      </Chips>
      {bookings.items.length ? (
        <ul className="flex flex-col gap-3">
          {bookings.items.map((b) => {
            const status = BOOKING_STATUS[b.display_status];
            return (
              <li key={b.id}>
                <Link href={`/bookings/${b.id}`} className={`${surfaceLink} flex items-center gap-4 p-4`}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <strong className="truncate">{b.parking.name}</strong>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {b.reference} · {b.hours} h · {formatRupees(b.amount)}
                      {b.ends_at ? ` · until ${formatDateTime(b.ends_at)}` : ` · booked ${formatDateTime(b.created_at)}`}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={<Ticket />}
          title="No bookings yet"
          body="Paid parking can be booked and paid for from its page on the map."
          action={
            <Button asChild>
              <Link href="/explore">Find parking</Link>
            </Button>
          }
        />
      )}
      <Pagination page={bookings.page} pages={bookings.pages} total={bookings.total} basePath="/bookings" query={query} />
    </div>
  );
}

export default function BookingsPage(props: PageProps<"/bookings">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BookingsContent {...props} />
    </Suspense>
  );
}
