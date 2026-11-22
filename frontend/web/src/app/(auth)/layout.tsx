import { Cctv, ShieldCheck, SquareParking } from "lucide-react";
import Link from "next/link";

import { Brand, BrandMark } from "@/components/common";

const POINTS = [
  { icon: <SquareParking />, text: "Verified public and private parking locations" },
  { icon: <Cctv />, text: "Real-time CCTV monitoring on major roads" },
  { icon: <ShieldCheck />, text: "Data protected under government digital-service standards" },
];

/** Painted parking bays, drawn flat — the only ornament on the panel. */
function Bays() {
  return (
    <svg viewBox="0 0 400 120" className="h-auto w-full max-w-md text-primary-foreground" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1={i * 50} y1="0" x2={i * 50} y2="120" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      ))}
      <line x1="0" y1="119" x2="400" y2="119" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      <rect x="61" y="18" width="28" height="84" rx="6" fill="currentColor" fillOpacity="0.14" />
      <rect x="161" y="18" width="28" height="84" rx="6" fill="currentColor" fillOpacity="0.14" />
      <rect x="311" y="18" width="28" height="84" rx="6" fill="currentColor" fillOpacity="0.14" />
      <rect x="211" y="44" width="28" height="32" rx="7" fill="#fff" />
      <text x="225" y="66" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--brand)" fontFamily="var(--font-heading)">
        P
      </text>
    </svg>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex xl:p-16">
        <Link href="/" className="flex w-fit items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <BrandMark className="bg-white text-brand" />
          <span className="font-heading text-lg font-semibold tracking-tight">Park Mandu</span>
        </Link>
        <div className="max-w-lg">
          <Bays />
          <h2 className="mt-12 text-4xl leading-[1.05] font-semibold tracking-[-0.03em] xl:text-5xl">
            One service for parking, landowners and traffic safety.
          </h2>
          <p className="mt-5 text-[0.9375rem] leading-relaxed text-primary-foreground/65">
            Residents find verified parking, landowners register private land for government approval, and traffic police respond to
            illegal parking detected by city CCTV.
          </p>
        </div>
        <ul className="flex flex-col gap-3 text-sm text-primary-foreground/70">
          {POINTS.map((p) => (
            <li key={p.text} className="flex items-center gap-3 [&_svg]:size-4 [&_svg]:shrink-0">
              {p.icon}
              {p.text}
            </li>
          ))}
        </ul>
      </aside>
      <main id="main" className="flex flex-col px-5 py-8 sm:px-8 lg:justify-center lg:py-16">
        <div className="mx-auto w-full max-w-[420px]">
          <Link href="/" className="mb-12 inline-flex rounded-lg lg:hidden" aria-label="Park Mandu home">
            <Brand subtitle="Kathmandu Valley" />
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
