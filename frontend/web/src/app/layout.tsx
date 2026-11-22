import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Funnel_Display, Funnel_Sans, IBM_Plex_Mono } from "next/font/google";
import { Suspense } from "react";

import { FlashToaster } from "@/components/interactive";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const funnelSans = Funnel_Sans({ subsets: ["latin"], variable: "--font-funnel-sans", display: "swap" });
const funnelDisplay = Funnel_Display({ subsets: ["latin"], variable: "--font-funnel-display", weight: ["500", "600", "700"], display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-plex-mono", weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Park Mandu", template: "%s · Park Mandu" },
  description: "Official smart parking and traffic monitoring service for Kathmandu Valley.",
  applicationName: "Park Mandu",
};

export const viewport: Viewport = {
  themeColor: "#fafaf8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(funnelSans.variable, funnelDisplay.variable, plexMono.variable)}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="top-center" richColors closeButton />
        <Suspense fallback={null}>
          <FlashToaster />
        </Suspense>
      </body>
    </html>
  );
}
