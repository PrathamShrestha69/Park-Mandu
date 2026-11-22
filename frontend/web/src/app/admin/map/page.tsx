import { Cctv } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";

import { MapLegend, MapView } from "@/components/map/map-view";
import { markersToPoints } from "@/components/parking";
import { ChipCount, Chips, Dot, PageHead, PageSkeleton, chipClass, surface } from "@/components/common";
import { apiGet } from "@/lib/api";
import type { AdminMap } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Parking map" };

const LAYERS = [
  { key: "approved", label: "Approved parking", dot: "bg-success" },
  { key: "pending", label: "Pending", dot: "bg-muted-foreground/60" },
  { key: "rejected", label: "Rejected", dot: "bg-destructive" },
  { key: "cameras", label: "CCTV cameras", dot: "bg-foreground/70" },
  { key: "incidents", label: "Illegal parking", dot: "bg-destructive" },
] as const;

async function AdminMapPageContent(props: PageProps<"/admin/map">) {
  const params = await props.searchParams;
  const raw = params.layers;
  const requested = (Array.isArray(raw) ? raw : raw ? raw.split(",") : []).filter((l) => LAYERS.some((x) => x.key === l));
  const active = requested.length ? requested : LAYERS.map((l) => l.key);
  const data = await apiGet<AdminMap>("/admin/map", { layers: active });
  const points = markersToPoints(data.markers, (m) =>
    m.kind === "parking" ? `/parking/${m.id}` : m.kind === "pending" || m.kind === "rejected" ? `/admin/applications/${m.id}` : undefined,
  );

  const toggle = (key: string) => {
    const next = active.includes(key) ? active.filter((k) => k !== key) : [...active, key];
    return `/admin/map${next.length && next.length < LAYERS.length ? `?layers=${next.join(",")}` : ""}`;
  };

  return (
    <>
      <PageHead title="Valley parking map" subtitle="Live operational overview of parking, applications and CCTV" back="/admin" />
      <Chips label="Map layers">
        {LAYERS.map((layer) => (
          <Link key={layer.key} href={toggle(layer.key)} className={chipClass} aria-pressed={active.includes(layer.key)}>
            {layer.key === "cameras" ? <Cctv className="size-3.5" /> : <Dot className={layer.dot} />}
            {layer.label}
            <ChipCount>{data.counts[layer.key] ?? 0}</ChipCount>
          </Link>
        ))}
      </Chips>
      <div className="mt-4">
        <MapView points={points} className="lg:h-[min(70vh,680px)]" label="Government-wide parking and monitoring map">
          <MapLegend
            items={[
              { label: "Approved", className: "bg-success" },
              { label: "Government", className: "bg-info" },
              { label: "Pending", className: "bg-muted-foreground/60" },
              { label: "Rejected / alert", className: "bg-destructive" },
              { label: "CCTV", className: "bg-foreground/70" },
            ]}
          />
        </MapView>
      </div>
      <div className={cn(surface, "mt-3 grid grid-cols-2 sm:grid-cols-4 [&>*:nth-child(n+2)]:border-l max-sm:[&>*:nth-child(3)]:border-l-0 max-sm:[&>*:nth-child(n+3)]:border-t")}>
        {[
          { label: "Map objects", value: data.markers.length },
          { label: "Parking", value: data.counts.approved ?? 0 },
          { label: "Cameras", value: data.counts.cameras ?? 0 },
          { label: "Alerts", value: data.counts.incidents ?? 0 },
        ].map((m) => (
          <div key={m.label} className="px-4 py-3">
            <strong className="block font-heading text-2xl leading-none font-semibold tabular-nums">{m.value}</strong>
            <small className="mt-1 block text-xs text-muted-foreground">{m.label}</small>
          </div>
        ))}
      </div>
    </>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function AdminMapPage(props: PageProps<"/admin/map">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminMapPageContent {...props} />
    </Suspense>
  );
}
