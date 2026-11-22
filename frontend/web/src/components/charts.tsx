"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { Dot } from "./common";

const AXIS = { fontSize: 12, fill: "var(--muted-foreground)" };
const GRID = "var(--border)";

/** Token-styled tooltip: text in ink, colour only on the key swatch. */
function ChartTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      {label !== undefined && <p className="mb-1.5 font-medium">{label}</p>}
      <ul className="flex flex-col gap-1">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <i className="inline-block size-2 rounded-[3px]" style={{ background: p.color }} />
              {p.name}
            </span>
            <strong className="font-mono font-medium tabular-nums">{p.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; className: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <Dot className={i.className} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export function ApplicationsChart({ data }: { data: { month: string; submitted: number; approved: number }[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ChartLegend
        items={[
          { label: "Submitted", className: "bg-chart-1" },
          { label: "Approved", className: "bg-chart-2" },
        ]}
      />
      <div className="h-56 w-full" role="img" aria-label="Parking applications submitted and approved over the last six months">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="month" tick={AXIS} axisLine={false} tickLine={false} tickMargin={8} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }} />
            <Area
              type="monotone"
              dataKey="submitted"
              name="Submitted"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="var(--chart-1)"
              fillOpacity={0.08}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            />
            <Area
              type="monotone"
              dataKey="approved"
              name="Approved"
              stroke="var(--chart-2)"
              strokeWidth={2}
              fill="var(--chart-2)"
              fillOpacity={0.08}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function OutcomeDonut({ approved, rejected, changes }: { approved: number; rejected: number; changes: number }) {
  const total = approved + rejected + changes;
  const data = [
    { name: "Approved", value: approved, color: "var(--success)", dot: "bg-success" },
    { name: "Rejected", value: rejected, color: "var(--destructive)", dot: "bg-destructive" },
    { name: "Changes requested", value: changes, color: "var(--chart-5)", dot: "bg-chart-5" },
  ];
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="relative size-40 shrink-0" role="img" aria-label={`Decided applications: ${data.map((d) => `${d.name} ${d.value}`).join(", ")}`}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={54} outerRadius={76} stroke="var(--card)" strokeWidth={2} startAngle={90} endAngle={-270}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <strong className="block font-heading text-3xl leading-none font-semibold tabular-nums">{total}</strong>
            <small className="text-xs text-muted-foreground">Decided</small>
          </div>
        </div>
      </div>
      <dl className="flex w-full flex-col gap-3">
        {data.map((d) => (
          <div key={d.name} className="flex items-center justify-between gap-3 border-b border-dashed pb-3 text-sm last:border-b-0 last:pb-0">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <Dot className={d.dot} />
              {d.name}
            </dt>
            <dd className="font-medium tabular-nums">
              {d.value} <span className="font-normal text-muted-foreground">· {total ? Math.round((d.value / total) * 100) : 0}%</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AreaIncidentsChart({ data }: { data: { area: string; count: number }[] }) {
  return (
    <div className="h-60 w-full" role="img" aria-label={`Illegal parking incidents by area in the last 30 days: ${data.map((d) => `${d.area} ${d.count}`).join(", ")}`}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }} barCategoryGap={6}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="area" tick={AXIS} axisLine={false} tickLine={false} width={96} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="count" name="Incidents" fill="var(--chart-3)" radius={[0, 4, 4, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CctvActivityChart({ data }: { data: { label: string; detections: number }[] }) {
  return (
    <div className="h-60 w-full" role="img" aria-label={`CCTV detections per day over the last week: ${data.map((d) => `${d.label} ${d.detections}`).join(", ")}`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} tickMargin={8} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="detections" name="Detections" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
