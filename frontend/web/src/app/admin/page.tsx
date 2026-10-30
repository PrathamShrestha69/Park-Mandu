import { Cctv, CircleCheck, CircleX, Clock, FileText, SquareParking, TriangleAlert, Users } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { ApplicationsChart, AreaIncidentsChart, CctvActivityChart, OutcomeDonut } from "@/components/charts";
import { ApplicationCard } from "@/components/parking";
import { PageHead, PageSkeleton, SectionTitle, StatCard, TextLink } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet } from "@/lib/api";
import type { ApplicationSummary, DashboardStats, Page } from "@/lib/types";

export const metadata: Metadata = { title: "Administration" };

function ChartCard({ title, meta, children }: { title: string; meta: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="font-semibold">{title}</CardTitle>
        <CardAction className="text-xs text-muted-foreground">{meta}</CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

async function AdminDashboardContent() {
  const [{ overview: o, charts }, pending] = await Promise.all([
    apiGet<DashboardStats>("/admin/stats"),
    apiGet<Page<ApplicationSummary>>("/admin/applications", { status: "pending", sort: "oldest", size: 3 }),
  ]);
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kathmandu" }).format(new Date());

  return (
    <>
      <PageHead
        eyebrow={today}
        title="Overview"
        subtitle="Parking registrations, approvals and road monitoring across Kathmandu Valley"
        actions={
          <Button asChild>
            <Link href="/admin/applications?status=pending">
              <FileText /> Review queue
              {o.pending_applications > 0 && (
                <span className="rounded-full bg-primary-foreground/15 px-1.5 font-mono text-xs tabular-nums">{o.pending_applications}</span>
              )}
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard href="/admin/map" icon={<SquareParking />} tone="blue" label="Registered parking" value={o.registered_parkings} note={`+${o.registered_this_month} this month`} />
        <StatCard href="/admin/applications?status=pending" icon={<Clock />} tone="amber" label="Pending applications" value={o.pending_applications} note={`${o.changes_requested} awaiting applicant changes`} />
        <StatCard href="/admin/applications?status=approved" icon={<CircleCheck />} tone="green" label="Approved locations" value={o.approved_applications} note="Private land approved" />
        <StatCard href="/admin/applications?status=rejected" icon={<CircleX />} tone="red" label="Rejected applications" value={o.rejected_applications} note="With reasons recorded" />
        <StatCard
          href="/admin/map?layers=cameras"
          icon={<Cctv />}
          tone="blue"
          label="Active CCTV cameras"
          value={o.cameras_live}
          note={`${o.cameras_total ? Math.round((o.cameras_live / o.cameras_total) * 100) : 0}% of ${o.cameras_total} online`}
        />
        <StatCard href="/admin/map?layers=incidents" icon={<TriangleAlert />} tone="red" label="Illegal parking alerts" value={o.active_alerts} note={`${o.high_priority_alerts} high priority`} />
        <StatCard href="/admin/map?layers=incidents" icon={<CircleCheck />} tone="green" label="Resolved incidents" value={o.resolved_incidents} note="Closed by traffic police" />
        <StatCard href="/admin/users" icon={<Users />} tone="gray" label="Registered users" value={o.registered_users} note="Public, police and officials" />
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <ChartCard title="Applications over time" meta="Last 6 months">
          <ApplicationsChart data={charts.applications_over_time} />
        </ChartCard>
        <ChartCard title="Approved vs rejected" meta={<TextLink href="/admin/applications?status=approved">View all</TextLink>}>
          <OutcomeDonut approved={charts.outcomes.approved} rejected={charts.outcomes.rejected} changes={charts.outcomes.changes_requested} />
        </ChartCard>
        <ChartCard title="Illegal parking by area" meta="Last 30 days">
          <AreaIncidentsChart data={charts.incidents_by_area} />
        </ChartCard>
        <ChartCard title="CCTV activity" meta="Detections per day">
          <CctvActivityChart data={charts.cctv_activity} />
        </ChartCard>
      </div>

      <SectionTitle title="Waiting longest" action={<TextLink href="/admin/applications?status=pending&sort=oldest">Review queue</TextLink>} />
      <div className="grid gap-3 lg:grid-cols-3">
        {pending.items.map((app) => (
          <ApplicationCard key={app.id} app={app} href={`/admin/applications/${app.id}`} showApplicant />
        ))}
      </div>
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function AdminDashboard() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminDashboardContent />
    </Suspense>
  );
}
