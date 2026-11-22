"use client";

import { Car, Gauge, Hourglass, Route, SquareParking, Timer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { TRAFFIC } from "@/lib/format";
import type { CameraTrackingState, TrackStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Badge, CctvFeed, surface } from "./common";

const POLL_MS = 2000;
const RETRY_MS = 3000;

const TRACK_STATUS: Record<TrackStatus, { label: string; tone: "success" | "warning" | "danger" }> = {
  moving: { label: "Moving", tone: "success" },
  stopped: { label: "Stopped", tone: "warning" },
  parked: { label: "Parked", tone: "danger" },
};

/** Polls the camera's live tracking while the tab is visible. `undefined` until the first answer. */
function useCameraTracking(cameraId: string, enabled: boolean): CameraTrackingState | null | undefined {
  const [state, setState] = useState<CameraTrackingState | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch(`/api/cameras/${cameraId}/tracking`, { cache: "no-store" });
          const body = response.ok ? ((await response.json()) as CameraTrackingState) : null;
          if (!cancelled) setState(body);
        } catch {
          if (!cancelled) setState(null);
        }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [cameraId, enabled]);

  return state;
}

/**
 * Annotated video from the AI detector (boxes and track IDs are drawn by the detector itself).
 * Browsers play its MJPEG stream in a plain <img>; if the stream drops it is reopened automatically.
 */
export function DetectorVideo({ streamUrl, label, stamp, reporting }: { streamUrl: string; label: string; stamp?: string; reporting: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setAttempt((n) => n + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  // A stream that stalled while the detector was down is reopened as soon as it reports again.
  const [wasReporting, setWasReporting] = useState(reporting);
  if (wasReporting !== reporting) {
    setWasReporting(reporting);
    if (reporting) {
      setPlaying(false);
      setAttempt((n) => n + 1);
    }
  }

  const live = playing && reporting;
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-[#1a2230]" role="img" aria-label={`Live AI video from camera ${label}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- MJPEG stream served by the detector on the local network */}
      <img
        key={attempt}
        src={`${streamUrl.replace(/\/$/, "")}/stream.mjpg?attempt=${attempt}`}
        alt=""
        className={cn("absolute inset-0 size-full object-contain transition-opacity", live ? "opacity-100" : "opacity-30")}
        onLoad={() => setPlaying(true)}
        onError={() => {
          setPlaying(false);
          setFailed(true);
        }}
      />
      <div className="pointer-events-none absolute inset-0 flex items-start justify-between p-2.5 font-mono text-[10px] font-medium text-white/90">
        <span className="inline-flex items-center gap-1.5 rounded bg-black/55 px-1.5 py-0.5">
          {live ? (
            <>
              <i className="size-1.5 animate-blink rounded-full bg-[#ff4d5a]" /> LIVE · AI TRACKING
            </>
          ) : (
            "CONNECTING"
          )}
        </span>
        <span className="rounded bg-black/55 px-1.5 py-0.5">{stamp ?? label}</span>
      </div>
      {!live && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-xs font-medium text-white/85">
          {reporting ? "Waiting for video from the AI detector…" : "The AI detector is not reporting. Reconnecting…"}
        </div>
      )}
    </div>
  );
}

function Figure({ icon, label, value, note }: { icon: ReactNode; label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 font-heading text-xl leading-none font-semibold tabular-nums">{value}</dd>
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function standing(seconds: number): string {
  if (seconds < 1) return "—";
  return seconds < 60 ? `${Math.round(seconds)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

/** Vehicle counts, measured traffic and the list of tracked vehicles, refreshed every two seconds. */
function TrackingPanel({ state }: { state: CameraTrackingState | null | undefined }) {
  const tracking = state?.tracking;
  if (state === undefined) {
    return <p className={cn(surface, "p-4 text-sm text-muted-foreground")}>Loading live tracking…</p>;
  }
  if (!tracking) {
    return (
      <p className={cn(surface, "p-4 text-sm text-muted-foreground")} role="status">
        No live tracking right now. Vehicle counts appear here while the AI detector for this camera is running.
      </p>
    );
  }
  const measured = tracking.avg_speed_kmh !== null;
  return (
    <section aria-label="Live vehicle tracking" className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Figure icon={<Car />} label="Vehicles in view" value={tracking.vehicle_count} note={`${tracking.moving_count} moving`} />
        <Figure icon={<Hourglass />} label="Stopped" value={tracking.stopped_count} note="Standing in the road" />
        <Figure icon={<SquareParking />} label="Parked" value={tracking.parked_count} note="Flagged for an alert" />
        <Figure icon={<Route />} label="Flow" value={tracking.flow_per_minute} note="Vehicles in the last minute" />
        <Figure
          icon={<Gauge />}
          label="Average speed"
          value={measured ? `${Math.round(tracking.avg_speed_kmh!)} km/h` : "—"}
          note={measured ? "Measured from tracking" : "Camera not calibrated for speed"}
        />
        <div className="rounded-lg border bg-card p-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Timer className="size-3.5" /> Traffic
          </dt>
          <dd className="mt-1.5">
            <Badge tone={TRAFFIC[state.traffic_level].tone}>{TRAFFIC[state.traffic_level].label}</Badge>
          </dd>
          <p className="mt-1 text-[11px] text-muted-foreground">{measured ? "From measured speed" : "Last known level"}</p>
        </div>
      </dl>

      <div className={cn(surface, "overflow-hidden")}>
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h3 className="font-sans text-sm font-semibold tracking-normal">Tracked vehicles</h3>
          <span className="font-mono text-[11px] text-muted-foreground">
            {Object.entries(tracking.counts_by_class)
              .map(([name, count]) => `${count} ${name.toLowerCase()}`)
              .join(" · ") || "none"}
          </span>
        </div>
        {tracking.tracks.length ? (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-2 pl-4 font-medium">ID</th>
                  <th className="px-2 py-2 font-medium">Vehicle</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 text-right font-medium">Speed</th>
                  <th className="px-2 py-2 text-right font-medium">Standing</th>
                  <th className="py-2 pr-4 pl-2 text-right font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {tracking.tracks.map((t) => (
                  <tr key={t.track_id} className="border-t">
                    <td className="py-2 pr-2 pl-4 font-mono text-xs font-medium">#{t.track_id}</td>
                    <td className="px-2 py-2">{t.vehicle_type}</td>
                    <td className="px-2 py-2">
                      <Badge tone={TRACK_STATUS[t.status].tone}>{TRACK_STATUS[t.status].label}</Badge>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.speed_kmh === null ? "—" : `${Math.round(t.speed_kmh)} km/h`}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{standing(t.stopped_seconds)}</td>
                    <td className="py-2 pr-4 pl-2 text-right tabular-nums">{Math.round(t.confidence * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No vehicles in view.</p>
        )}
      </div>
    </section>
  );
}

/**
 * Camera view for the police console. Cameras with an AI detector show its annotated video and live
 * tracking; simulated cameras keep the drawn placeholder scene.
 */
export function LiveCameraFeed({
  cameraId,
  streamUrl,
  aiEnabled,
  label,
  stamp,
  offline,
  detection,
}: {
  cameraId: string;
  streamUrl: string | null;
  aiEnabled: boolean;
  label: string;
  stamp?: string;
  offline?: boolean;
  detection?: string;
}) {
  const state = useCameraTracking(cameraId, aiEnabled);
  if (!aiEnabled) {
    return <CctvFeed label={label} stamp={stamp} offline={offline} detection={detection} />;
  }
  // Until the first poll answers, trust the server-rendered camera status.
  const reporting = state === undefined ? !offline : !!state?.tracking;
  return (
    <div className="flex flex-col gap-3">
      {streamUrl ? (
        <DetectorVideo streamUrl={streamUrl} label={label} stamp={stamp} reporting={reporting} />
      ) : (
        <div className="grid aspect-video place-items-center rounded-xl bg-[#1a2230] px-6 text-center text-xs font-medium text-white/85">
          This detector runs without a video preview. Live tracking is shown below.
        </div>
      )}
      <TrackingPanel state={state} />
    </div>
  );
}
