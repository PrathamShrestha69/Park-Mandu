"use client";

import { MapPin, Navigation } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { respondToDispatchAction, updateLocationAction } from "@/lib/actions/operations";
import type { Role } from "@/lib/types";

import { RealtimeProvider, useLiveRefresh, useRealtime, type RealtimeEvent } from "./realtime";

/** Which server events make each role's screens re-render (see backend app/core/realtime.py). */
const REFRESH_ON: Record<Role, string[]> = {
  public: ["parking:update", "parking:added", "notification:new"],
  police: ["parking:update", "alert:new", "alert:update", "dispatch:update", "dispatch:assigned", "notification:new"],
  admin: ["parking:update", "parking:added", "alert:new", "alert:update", "dispatch:update", "suggestion:new", "admin:update", "notification:new"],
};

function LiveBridge({ role }: { role: Role }) {
  const router = useRouter();
  useLiveRefresh(REFRESH_ON[role]);

  useRealtime("notification:new", (e) => {
    // Call-outs get their own prompt with Acknowledge / Decline below.
    if (e.kind === "incident_dispatch") return;
    const show = e.tone === "danger" ? toast.error : e.tone === "warning" ? toast.warning : e.tone === "success" ? toast.success : toast.info;
    show(String(e.title), {
      description: String(e.body ?? ""),
      action: { label: "View", onClick: () => router.push(role === "public" ? "/notifications" : role === "police" ? "/police" : "/admin") },
    });
  });

  useRealtime("dispatch:none", (e) => {
    toast.warning(String(e.message), {
      description: `${e.violation_label} on ${e.road}${e.plate_number ? ` · ${e.plate_number}` : ""}`,
      action: { label: "View", onClick: () => router.push(role === "admin" ? "/admin/map" : `/police/alerts/${e.alert_id}`) },
      duration: 12_000,
    });
  });

  useRealtime("suggestion:new", (e) => {
    if (role !== "admin") return;
    toast.info("New suggestion received", {
      description: String(e.preview ?? ""),
      action: { label: "Open", onClick: () => router.push("/admin/suggestions") },
    });
  });

  return null;
}

/** Persistent prompt shown only to the one officer chosen for an incident. */
function DispatchPrompt() {
  const router = useRouter();
  useRealtime("dispatch:assigned", (e: RealtimeEvent) => {
    const alertId = String(e.alert_id);
    const distance = typeof e.distance_m === "number" ? `${e.distance_m} m away` : "Nearby";
    const time = new Date(String(e.detected_at)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const respond = async (accept: boolean) => {
      const result = await respondToDispatchAction(alertId, accept);
      if (result.ok) {
        toast.success(result.message);
        if (accept) router.push(`/police/alerts/${alertId}`);
      } else {
        toast.error(result.message);
      }
    };
    toast.error(`You have been dispatched · ${e.violation_label}`, {
      id: `dispatch-${alertId}`, // the same incident never stacks two prompts
      description: `${e.road}, ${e.area} · ${distance} · ${e.vehicle_type}${e.plate_number ? ` ${e.plate_number}` : ""} · detected ${time}`,
      duration: Infinity,
      icon: <Navigation className="size-4" />,
      action: { label: "Acknowledge", onClick: () => void respond(true) },
      cancel: { label: "Decline", onClick: () => void respond(false) },
    });
  });
  return null;
}

const SEND_EVERY_MS = 30_000;
const SEND_AFTER_METRES = 50;

function metresBetween(a: GeolocationCoordinates, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const x = (b.longitude - a.longitude) * rad * Math.cos(((a.latitude + b.latitude) / 2) * rad);
  const y = (b.latitude - a.latitude) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/**
 * While an officer is on duty, their position is shared so incidents reach the nearest officer.
 * Sent at most every 30 s, or sooner after moving 50 m; stops as soon as they go off duty.
 */
export function OfficerLocation({ onDuty }: { onDuty: boolean }) {
  const [geo, setGeo] = useState<"sharing" | "blocked" | "unavailable">("sharing");
  const last = useRef<{ latitude: number; longitude: number; at: number } | null>(null);

  useEffect(() => {
    if (!onDuty || !("geolocation" in navigator)) return;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        setGeo("sharing");
        const prev = last.current;
        const now = Date.now();
        if (prev && now - prev.at < SEND_EVERY_MS && metresBetween(pos.coords, prev) < SEND_AFTER_METRES) return;
        last.current = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, at: now };
        void updateLocationAction(pos.coords.latitude, pos.coords.longitude);
      },
      (error) => setGeo(error.code === error.PERMISSION_DENIED ? "blocked" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [onDuty]);

  const state = onDuty ? geo : "off";
  if (state === "off" || state === "sharing") return null;
  return (
    <div className="fixed inset-x-3 bottom-20 z-50 flex items-start gap-2 rounded-lg border border-warning/40 bg-card px-3 py-2 text-xs shadow-md lg:inset-x-auto lg:right-6 lg:bottom-6 lg:max-w-sm" role="status">
      <MapPin className="mt-0.5 size-4 shrink-0 text-warning-ink" />
      <span>
        {state === "blocked"
          ? "Location access is blocked, so you will not receive nearby incident call-outs. Allow location for this site in your browser."
          : "Your location could not be found, so you may miss nearby incident call-outs."}
      </span>
    </div>
  );
}

export function LiveUpdates({ role, children }: { role: Role; children: React.ReactNode }) {
  return (
    <RealtimeProvider>
      <LiveBridge role={role} />
      {role === "police" && <DispatchPrompt />}
      {children}
    </RealtimeProvider>
  );
}
