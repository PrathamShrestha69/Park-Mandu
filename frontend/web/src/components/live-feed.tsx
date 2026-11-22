"use client";

import { useEffect, useState } from "react";

import { CctvFeed } from "@/components/common";

const RETRY_MS = 3000;

/**
 * Live annotated video from the Park Mandu AI detector (MJPEG over HTTP). If the stream drops or the
 * detector restarts, it keeps reconnecting instead of giving up, so the page recovers on its own.
 * Cameras with no detector attached show the illustrated placeholder.
 */
export function LiveCameraFeed({
  streamUrl,
  label,
  stamp,
  offline,
  detection,
}: {
  streamUrl: string | null;
  label: string;
  stamp?: string;
  offline?: boolean;
  detection?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!retrying) return;
    const timer = setTimeout(() => {
      setRetrying(false);
      setAttempt((n) => n + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [retrying]);

  if (!streamUrl || offline) {
    return <CctvFeed label={label} stamp={stamp} offline={offline} detection={detection} />;
  }

  // A new query string forces the browser to open a fresh connection on each retry.
  const src = `${streamUrl.replace(/\/$/, "")}/stream.mjpg?attempt=${attempt}`;

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-[#1a2230]">
      {!playing && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/70">
          <p>
            {retrying ? "Connecting to the AI detector…" : "Waiting for video from the AI detector…"}
            <br />
            <span className="text-xs text-white/50">
              Video comes from {streamUrl}. If this stays, check that the detector is running and its --source is reachable.
            </span>
          </p>
        </div>
      )}
      {!retrying && (
        // eslint-disable-next-line @next/next/no-img-element -- MJPEG streams cannot go through next/image
        <img
          key={attempt}
          src={src}
          alt={`Live video from camera ${label}`}
          className="relative size-full object-contain"
          onLoad={() => setPlaying(true)}
          onError={() => {
            setPlaying(false);
            setRetrying(true);
          }}
        />
      )}
      <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded bg-black/55 px-2 py-0.5 font-mono text-[0.6875rem] tracking-wider text-white">
        <span className="size-1.5 animate-pulse rounded-full bg-[#ff4d5a]" /> LIVE · AI
      </span>
    </div>
  );
}
