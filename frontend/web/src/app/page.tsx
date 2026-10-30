import { ArrowRight, Cctv, FileCheck2, MapPin, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Brand, LiveDot } from "@/components/common";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: <MapPin />,
    title: "Find parking nearby",
    body: "Live availability for public and approved private parking across the valley, sorted by walking distance.",
  },
  {
    icon: <FileCheck2 />,
    title: "Register your land",
    body: "Landowners apply online in about ten minutes and follow the government review step by step.",
  },
  {
    icon: <Cctv />,
    title: "Keep roads clear",
    body: "CCTV analytics alert traffic police to illegal parking in real time, so junctions stay moving.",
  },
];

/** Flat, drawn product preview: a parking map with bays and a result card. */
function HeroVisual() {
  return (
    <div className="relative mx-auto mt-16 w-full max-w-5xl md:mt-20" aria-hidden>
      <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/[0.08]">
        <svg viewBox="0 0 960 420" className="block h-auto w-full">
          <rect width="960" height="420" fill="var(--muted)" />
          <g stroke="var(--border)" strokeWidth="1">
            {Array.from({ length: 16 }, (_, i) => (
              <line key={`v${i}`} x1={i * 64} y1="0" x2={i * 64} y2="420" />
            ))}
            {Array.from({ length: 7 }, (_, i) => (
              <line key={`h${i}`} x1="0" y1={i * 64} x2="960" y2={i * 64} />
            ))}
          </g>
          <path d="M-20 300 C 200 260, 320 330, 520 250 S 860 150, 980 180" fill="none" stroke="var(--card)" strokeWidth="26" strokeLinecap="round" />
          <path d="M300 -20 C 330 120, 280 260, 360 440" fill="none" stroke="var(--card)" strokeWidth="18" strokeLinecap="round" />
          <path d="M640 -20 L 600 440" fill="none" stroke="var(--card)" strokeWidth="14" />
          <rect x="420" y="70" width="150" height="96" rx="10" fill="var(--card)" stroke="var(--border)" />
          {Array.from({ length: 6 }, (_, i) => (
            <rect key={i} x={432 + i * 22} y="82" width="14" height="30" rx="3" fill={i === 1 || i === 4 ? "var(--chart-5)" : "var(--success)"} opacity={i === 1 || i === 4 ? 1 : 0.85} />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <rect key={`b${i}`} x={432 + i * 22} y="124" width="14" height="30" rx="3" fill={i === 2 ? "var(--chart-5)" : "var(--success)"} opacity={i === 2 ? 1 : 0.85} />
          ))}
          <g>
            <rect x="196" y="186" width="34" height="34" rx="9" fill="var(--success)" stroke="#fff" strokeWidth="3" />
            <text x="213" y="209" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff" fontFamily="var(--font-heading)">P</text>
          </g>
          <g>
            <rect x="482" y="196" width="34" height="34" rx="9" fill="var(--info)" stroke="#fff" strokeWidth="3" />
            <text x="499" y="219" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff" fontFamily="var(--font-heading)">P</text>
          </g>
          <g>
            <rect x="760" y="110" width="34" height="34" rx="9" fill="var(--success)" stroke="#fff" strokeWidth="3" />
            <text x="777" y="133" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff" fontFamily="var(--font-heading)">P</text>
          </g>
          <g>
            <rect x="716" y="300" width="34" height="34" rx="9" fill="var(--destructive)" stroke="#fff" strokeWidth="3" />
            <text x="733" y="323" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff" fontFamily="var(--font-heading)">P</text>
          </g>
          <circle cx="352" cy="268" r="9" fill="var(--info)" stroke="#fff" strokeWidth="3" />
          <circle cx="352" cy="268" r="20" fill="var(--info)" opacity="0.15" />
        </svg>
      </div>
      <div className="absolute -bottom-6 left-4 w-[min(320px,calc(100%-2rem))] rounded-xl bg-card p-4 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.18)] ring-1 ring-foreground/[0.08] md:-bottom-8 md:left-10">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-success/12 font-heading text-lg font-semibold text-success-ink">P</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">Bhrikutimandap Parking</p>
            <p className="text-xs text-muted-foreground">350 m · 4 min walk</p>
          </div>
          <div className="text-right leading-none">
            <p className="font-heading text-xl font-semibold tabular-nums">42</p>
            <p className="mt-1 text-[11px] text-muted-foreground">free</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Splash() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-8">
        <Brand />
        <nav className="flex items-center gap-1.5">
          <Button asChild variant="ghost">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild className="hidden sm:inline-flex">
            <Link href="/register">Create account</Link>
          </Button>
        </nav>
      </header>

      <main id="main" className="px-4 pt-14 pb-24 md:px-8 md:pt-24">
        <section className="mx-auto max-w-6xl">
          <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <LiveDot className="text-success" />
            Official service · Kathmandu Valley
          </p>
          <h1 className="mt-6 max-w-4xl text-4xl leading-[1.05] font-semibold tracking-[-0.03em] sm:text-5xl md:text-6xl">
            Parking that works for the whole valley.
          </h1>
          <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <p className="max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              Find a verified space in seconds, turn unused land into approved parking, and help traffic police keep junctions clear.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Button asChild size="lg">
                <Link href="/register">
                  Create an account <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>

        <HeroVisual />

        <section className="mx-auto mt-28 grid max-w-6xl gap-10 md:mt-36 md:grid-cols-3 md:gap-8" aria-label="What Park Mandu does">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="border-t pt-6">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="font-mono text-xs">0{i + 1}</span>
                <span className="[&_svg]:size-5">{f.icon}</span>
              </div>
              <h2 className="mt-8 text-xl font-semibold md:text-2xl">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-[0.9375rem]">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-8">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-3.5" /> Official government service for Kathmandu Valley
          </span>
          <span>Data protected under national digital-service standards</span>
        </div>
      </footer>
    </div>
  );
}
