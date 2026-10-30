"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "./common";

interface LiveAlert {
  id: string;
  code: string;
  severity: "high" | "medium" | "low";
  violation_label: string;
  camera_code: string;
  road: string;
  plate_number: string | null;
}

/**
 * Subscribes to the server-sent event stream of new CCTV detections. New alerts raise a toast
 * and re-render the current page's Server Components so counters and lists stay current.
 */
export function LiveAlerts() {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/stream/alerts");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("alert", (event) => {
      const alert = JSON.parse((event as MessageEvent).data) as LiveAlert;
      const notify = alert.severity === "high" ? toast.error : toast.warning;
      notify(`Illegal parking detected · ${alert.camera_code}`, {
        description: `${alert.violation_label} on ${alert.road}${alert.plate_number ? ` · ${alert.plate_number}` : ""}`,
        action: { label: "View", onClick: () => router.push(`/police/alerts/${alert.id}`) },
        duration: 9000,
      });
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 800);
    });
    return () => {
      source.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [router]);

  return (
    <span title="Real-time alert feed" aria-live="polite">
      <Badge tone={connected ? "success" : "neutral"} live>
        {connected ? "Live feed" : "Connecting…"}
      </Badge>
    </span>
  );
}
