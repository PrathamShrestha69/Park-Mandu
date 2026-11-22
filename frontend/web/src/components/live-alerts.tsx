"use client";

import { Badge } from "./common";
import { useRealtimeStatus } from "./realtime";

/**
 * Shows whether this screen is receiving live updates. New detections refresh lists and counters
 * through the shared Socket.IO connection (see live-updates.tsx); only the officer chosen by
 * nearest-officer dispatch is prompted to respond, so nobody else gets a pop-up for every alert.
 */
export function LiveAlerts() {
  const connected = useRealtimeStatus();
  return (
    <span title="Real-time alert feed" aria-live="polite">
      <Badge tone={connected ? "success" : "neutral"} live>
        {connected ? "Live feed" : "Connecting…"}
      </Badge>
    </span>
  );
}
