import { ArrowLeft, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { buildQuery, type Query } from "@/lib/api-query";
import type { Tone } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Static surface: white card with a hairline ring. */
export const surface = "rounded-xl border bg-card text-card-foreground shadow-[0_1px_2px_rgb(16_24_40/0.04)]";
/** Surface that is also a link or button. */
export const surfaceLink = cn(
  surface,
  "block transition-[border-color,box-shadow] duration-150 hover:border-foreground/15 hover:shadow-[0_4px_12px_-2px_rgb(16_24_40/0.08)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
);

const BADGE_VARIANT = {
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
  neutral: "secondary",
} as const;

export function Badge({ tone = "neutral", children, live, className }: { tone?: Tone; children: ReactNode; live?: boolean; className?: string }) {
  return (
    <UiBadge variant={BADGE_VARIANT[tone]} className={cn("h-6 gap-1.5 rounded-md border px-2 [&:has(svg)>i]:hidden", className)}>
      {live ? <LiveDot /> : <i aria-hidden className="inline-block size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </UiBadge>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return <i aria-hidden className={cn("inline-block size-1.5 shrink-0 animate-blink rounded-full bg-current", className)} />;
}

/** Status dot used in legends and lists. */
export function Dot({ className }: { className?: string }) {
  return <i aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} />;
}

export function BrandMark({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-lg bg-brand font-heading font-bold text-brand-foreground",
        size === "sm" && "size-7 text-[15px]",
        size === "md" && "size-9 text-lg",
        size === "lg" && "size-14 text-3xl",
        className,
      )}
    >
      P
    </span>
  );
}

export function Brand({ subtitle, size = "md", className }: { subtitle?: string; size?: "sm" | "md"; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandMark size={size} />
      <span className="min-w-0 leading-tight">
        <strong className="block font-heading text-[17px] font-semibold tracking-tight">Park Mandu</strong>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
    </span>
  );
}

export function PageHead({
  title,
  subtitle,
  eyebrow,
  back,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  back?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 items-start gap-3">
        {back && (
          <Button asChild variant="outline" size="icon" className="shrink-0">
            <Link href={back} aria-label="Go back">
              <ArrowLeft />
            </Link>
          </Button>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="mb-0.5 text-[0.8125rem] text-muted-foreground">{eyebrow}</p>}
          <h1 className="text-xl leading-tight font-semibold md:text-2xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ title, action, id }: { title: string; action?: ReactNode; id?: string }) {
  return (
    <div className="mt-8 mb-3 flex items-center justify-between gap-3 first:mt-0">
      <h2 id={id} className="text-[0.9375rem] font-semibold">
        {title}
      </h2>
      {action && <div className="text-sm text-muted-foreground">{action}</div>}
    </div>
  );
}

/** Small text link used beside section titles. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
    >
      {children}
      <ChevronRight className="size-3.5" />
    </Link>
  );
}

const CALLOUT = {
  info: { className: "border-info/20 bg-info/[0.06] text-info-ink", icon: <Info /> },
  success: { className: "border-success/25 bg-success/[0.08] text-success-ink", icon: <CircleCheck /> },
  warning: { className: "border-warning/40 bg-warning/[0.12] text-warning-ink", icon: <TriangleAlert /> },
  danger: { className: "border-destructive/25 bg-destructive/[0.06] text-destructive", icon: <CircleAlert /> },
};

export function Callout({
  tone = "info",
  icon,
  title,
  children,
  className,
}: {
  tone?: keyof typeof CALLOUT;
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const t = CALLOUT[tone];
  return (
    <Alert className={cn("gap-y-1 px-3.5 py-3 [&>svg]:size-4!", t.className, className)} role={tone === "danger" ? "alert" : "status"}>
      {icon ?? t.icon}
      {title && <AlertTitle className="font-semibold">{title}</AlertTitle>}
      <AlertDescription className="text-current/85 md:text-pretty">{children}</AlertDescription>
    </Alert>
  );
}

/** Label/value row; use several inside a <dl>. */
export function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-dashed py-2.5 text-sm last:border-b-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{value ?? "—"}</dd>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <Empty className="border border-dashed bg-card py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-10 rounded-xl [&_svg:not([class*='size-'])]:size-5">
          {icon}
        </EmptyMedia>
        <EmptyTitle className="text-base font-semibold">{title}</EmptyTitle>
        {body && <EmptyDescription>{body}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function ErrorState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Empty className="border border-dashed border-destructive/30 bg-card py-12" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-10 rounded-xl bg-destructive/10 text-destructive [&_svg:not([class*='size-'])]:size-5">
          <CircleAlert />
        </EmptyMedia>
        <EmptyTitle className="text-base font-semibold">{title}</EmptyTitle>
        {body && <EmptyDescription>{body}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function SkeletonList({ count = 4, height = 88 }: { count?: number; height?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="rounded-xl" style={{ height }} />
      ))}
    </div>
  );
}

export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 mb-8 h-4 w-72 max-w-full" />
      <SkeletonList count={cards} />
    </div>
  );
}

/** Server-rendered pagination that preserves the current filters in the query string. */
export function Pagination({
  page,
  pages,
  total,
  basePath,
  query,
}: {
  page: number;
  pages: number;
  total: number;
  basePath: string;
  query: Query;
}) {
  const summary = (
    <span className="text-sm text-muted-foreground tabular-nums">
      {pages > 1 ? `Page ${page} of ${pages} · ` : ""}
      {total} result{total === 1 ? "" : "s"}
    </span>
  );
  if (pages <= 1) return <div className="mt-5">{summary}</div>;
  const href = (p: number) => `${basePath}${buildQuery({ ...query, page: p > 1 ? p : undefined })}`;
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const numbers = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  return (
    <nav className="mt-5 flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
      {summary}
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Button asChild variant="outline" size="icon">
            <Link href={href(page - 1)} aria-label="Previous page">
              <ChevronLeft />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="icon" disabled aria-hidden tabIndex={-1}>
            <ChevronLeft />
          </Button>
        )}
        {numbers.map((n) => (
          <Button key={n} asChild variant={n === page ? "default" : "ghost"} size="icon" className="tabular-nums">
            <Link href={href(n)} aria-current={n === page ? "page" : undefined}>
              {n}
            </Link>
          </Button>
        ))}
        {page < pages ? (
          <Button asChild variant="outline" size="icon">
            <Link href={href(page + 1)} aria-label="Next page">
              <ChevronRight />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="icon" disabled aria-hidden tabIndex={-1}>
            <ChevronRight />
          </Button>
        )}
      </div>
    </nav>
  );
}

/** Horizontal, scrollable row of filter pills. */
export function Chips({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div
      className={cn("no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 py-1 md:mx-0 md:flex-wrap md:px-0", className)}
      aria-label={label}
      role={label ? "group" : undefined}
    >
      {children}
    </div>
  );
}

export const chipClass = cn(
  "group/chip inline-flex h-8 shrink-0 items-center gap-2 rounded-md border bg-card px-3 text-[0.8125rem] font-medium whitespace-nowrap text-muted-foreground shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-colors",
  "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
  "aria-[current=true]:border-primary/30 aria-[current=true]:bg-primary/[0.08] aria-[current=true]:text-primary",
  "aria-pressed:border-primary/30 aria-pressed:bg-primary/[0.08] aria-pressed:text-primary",
);

export function ChipCount({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-5 min-w-5 place-items-center rounded bg-muted px-1 font-mono text-[11px] text-muted-foreground tabular-nums group-aria-[current=true]/chip:bg-primary group-aria-[current=true]/chip:text-primary-foreground group-aria-pressed/chip:bg-primary group-aria-pressed/chip:text-primary-foreground">
      {children}
    </span>
  );
}

/** Filter chip that links to the same page with one query value changed. */
export function ChipLink({
  basePath,
  query,
  param,
  value,
  current,
  children,
  count,
}: {
  basePath: string;
  query: Query;
  param: string;
  value: string | undefined;
  current: string | undefined;
  children: ReactNode;
  count?: number;
}) {
  const active = (current ?? "") === (value ?? "");
  return (
    <Link
      className={chipClass}
      aria-current={active ? "true" : undefined}
      href={`${basePath}${buildQuery({ ...query, [param]: value, page: undefined })}`}
    >
      {children}
      {count !== undefined && <ChipCount>{count}</ChipCount>}
    </Link>
  );
}

const STAT_TILE: Record<string, string> = {
  red: "bg-destructive/10 text-destructive",
  blue: "bg-info/10 text-info-ink",
  green: "bg-success/12 text-success-ink",
  amber: "bg-warning/18 text-warning-ink",
  cyan: "bg-info/10 text-info-ink",
  violet: "bg-primary/10 text-primary",
  gray: "bg-muted text-muted-foreground",
};

/** Metric card: tinted icon tile, label, headline number, note. */
export function StatCard({
  href,
  icon,
  tone = "gray",
  label,
  value,
  note,
}: {
  href: string;
  icon: ReactNode;
  tone?: keyof typeof STAT_TILE;
  label: string;
  value: number;
  note: ReactNode;
}) {
  return (
    <Link href={href} className={cn(surfaceLink, "group flex flex-col gap-3 p-4")}>
      <span className="flex items-center gap-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-md [&_svg]:size-4", STAT_TILE[tone])}>{icon}</span>
        <span className="min-w-0 truncate text-[0.8125rem] font-medium text-muted-foreground">{label}</span>
      </span>
      <strong className="text-2xl leading-none font-semibold tracking-tight tabular-nums md:text-[1.75rem]">{value.toLocaleString()}</strong>
      <span className="text-xs text-muted-foreground">{note}</span>
    </Link>
  );
}

/** Flat, drawn road scene standing in for a live CCTV video stream. */
export function CctvFeed({
  label,
  stamp,
  offline,
  detection,
  className,
}: {
  label: string;
  stamp?: string;
  offline?: boolean;
  detection?: string;
  large?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("relative aspect-video overflow-hidden rounded-xl bg-[#1a2230]", offline && "grayscale", className)}
      role="img"
      aria-label={`CCTV feed ${label}${offline ? ", offline" : ""}`}
    >
      <svg viewBox="0 0 320 180" className={cn("absolute inset-0 size-full", offline && "opacity-40")} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <rect width="320" height="74" fill="#202a3a" />
        <rect x="10" y="30" width="70" height="44" fill="#172031" />
        <rect x="18" y="38" width="8" height="6" fill="#2c3a50" />
        <rect x="34" y="38" width="8" height="6" fill="#3a4a62" />
        <rect x="50" y="38" width="8" height="6" fill="#2c3a50" />
        <rect x="18" y="52" width="8" height="6" fill="#3a4a62" />
        <rect x="250" y="44" width="56" height="30" fill="#172031" />
        <rect y="74" width="320" height="106" fill="#2a313c" />
        <polygon points="130,74 190,74 320,180 0,180" fill="#3b4350" />
        <polygon points="158,74 162,74 166,92 154,92" fill="#d9d2a6" opacity=".7" />
        <polygon points="152,104 168,104 174,128 146,128" fill="#d9d2a6" opacity=".7" />
        <polygon points="142,142 178,142 186,180 134,180" fill="#d9d2a6" opacity=".7" />
        <g>
          <rect x="62" y="128" width="58" height="36" rx="6" fill="#e8ecf1" />
          <rect x="70" y="133" width="42" height="12" rx="3" fill="#2a3442" />
        </g>
        {!offline && (
          <>
            <g className="cctv-car">
              <rect x="176" y="96" width="30" height="20" rx="4" fill="#c8453f" />
              <rect x="180" y="99" width="22" height="7" rx="2" fill="#2a3442" />
            </g>
            <g className="cctv-car slow">
              <rect x="150" y="80" width="20" height="13" rx="3" fill="#3d6fd1" />
              <rect x="153" y="82" width="14" height="5" rx="1.5" fill="#2a3442" />
            </g>
          </>
        )}
      </svg>
      {detection && !offline && (
        <span className="absolute bottom-[6%] left-[17%] h-[28%] w-[23%] rounded-md border-2 border-[#ff4d5a]">
          <span className="absolute -top-6 -left-0.5 rounded-sm bg-[#ff4d5a] px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white">
            {detection}
          </span>
        </span>
      )}
      <div className="pointer-events-none absolute inset-0 flex items-start justify-between p-2.5 font-mono text-[10px] font-medium text-white/90">
        <span className="inline-flex items-center gap-1.5 rounded bg-black/45 px-1.5 py-0.5">
          {offline ? (
            "NO SIGNAL"
          ) : (
            <>
              <i className="size-1.5 animate-blink rounded-full bg-[#ff4d5a]" /> LIVE
            </>
          )}
        </span>
        <span className="rounded bg-black/45 px-1.5 py-0.5">{stamp ?? label}</span>
      </div>
      {offline && (
        <div className="absolute inset-0 grid place-items-center font-mono text-xs font-medium tracking-[0.2em] text-white">CAMERA OFFLINE</div>
      )}
    </div>
  );
}

/** Labelled native select for GET filter forms. */
export function FilterSelect({
  id,
  label,
  defaultValue,
  children,
}: {
  id: string;
  label: string;
  defaultValue?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <NativeSelect id={id} name={id} defaultValue={defaultValue} className="w-full">
        {children}
      </NativeSelect>
    </div>
  );
}
