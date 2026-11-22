import { Cctv, PenLine, Plug, Unplug, Video } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Badge, Callout, Chips, KV, PageHead, PageSkeleton, SectionTitle, chipClass, surface } from "@/components/common";
import { ActionForm, FormAlert, SubmitButton, TextField } from "@/components/forms";
import { AutoRefresh, CopyButton } from "@/components/interactive";
import { DetectorVideo } from "@/components/live-feed";
import { AvailabilityBadge, OccupancyBar } from "@/components/parking";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { connectCameraAction, correctOccupancyAction, disconnectCameraAction } from "@/lib/actions/occupancy";
import { apiGet } from "@/lib/api";
import { formatDateTime, timeAgo, vehicleTypesLabel } from "@/lib/format";
import type { CameraConnection, OwnerCamera, OwnerParking, Tone } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Occupancy monitoring" };

const CONNECTION_TONE: Record<CameraConnection, Tone> = {
  connected: "success",
  waiting: "info",
  disconnected: "danger",
  maintenance: "warning",
};

function Figure({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="px-4 py-4 md:px-5">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <strong className="mt-1.5 block font-heading text-3xl leading-none font-semibold tabular-nums">{value}</strong>
      <span className="mt-1.5 block text-[11px] text-muted-foreground">{note}</span>
    </div>
  );
}

function CameraForm({ parking, camera }: { parking: OwnerParking; camera: OwnerCamera | null }) {
  return (
    <ActionForm action={connectCameraAction} className="flex flex-col gap-4">
      <input type="hidden" name="parking_id" value={parking.id} />
      <TextField name="name" label="Camera name" icon={<Cctv />} defaultValue={camera?.name ?? `${parking.name} entrance`} required />
      <TextField
        name="source_url"
        label="CCTV stream address"
        icon={<Video />}
        defaultValue={camera?.source_url ?? ""}
        placeholder="rtsp://192.168.1.20:554/stream1"
        hint="The RTSP or HTTP address of your camera or NVR. The AI detector reads the video from here."
        required
      />
      <FormAlert />
      <SubmitButton pendingLabel="Saving…" block={false} icon={<Plug />}>
        {camera ? "Save camera" : "Connect camera"}
      </SubmitButton>
    </ActionForm>
  );
}

function CameraCard({ parking }: { parking: OwnerParking }) {
  const camera = parking.camera;
  if (!camera) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-semibold">Connect a CCTV camera</CardTitle>
          <CardDescription>
            The same AI vehicle detection used by the traffic police counts the vehicles parked here and keeps your free spaces up to date. Each vehicle is
            tracked while it is in view, so it is only counted once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CameraForm parking={parking} camera={null} />
        </CardContent>
      </Card>
    );
  }

  const connected = camera.connection === "connected";
  const command = `vehicle_detection\\.venv\\Scripts\\python camera-bridge\\bridge.py --camera-code ${camera.code}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-semibold">{camera.name}</CardTitle>
        <CardAction>
          <Badge tone={CONNECTION_TONE[camera.connection]} live={connected}>
            {camera.connection_label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {connected && camera.stream_url && <DetectorVideo streamUrl={camera.stream_url} label={camera.code} reporting />}
        {camera.connection === "disconnected" && (
          <Callout tone="danger" icon={<Unplug />} title="Camera disconnected">
            The AI detector stopped reporting {camera.last_seen_at ? timeAgo(camera.last_seen_at) : ""}. Free spaces stay at the last count until it
            reconnects; correct the count below if it changes meanwhile.
          </Callout>
        )}
        {camera.connection === "waiting" && (
          <Callout tone="info" icon={<Cctv />} title="Start the AI detector">
            Run this on the computer that can reach the camera. It reads the stream address you saved and starts counting.
            <code className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-2 font-mono text-[11px] break-all text-foreground">
              {command}
              <CopyButton value={command} label="Copy" />
            </code>
          </Callout>
        )}
        <dl>
          <KV label="Camera code" value={<span className="font-mono text-xs">{camera.code}</span>} />
          <KV label="Stream" value={<span className="font-mono text-xs break-all">{camera.source_url}</span>} />
          <KV label="Vehicles detected now" value={camera.detected_vehicles ?? "—"} />
          <KV label="Last report" value={camera.last_seen_at ? formatDateTime(camera.last_seen_at) : "Never"} />
        </dl>
        <details className="group rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Change camera</summary>
          <div className="mt-4">
            <CameraForm parking={parking} camera={camera} />
          </div>
        </details>
        <form action={disconnectCameraAction}>
          <input type="hidden" name="parking_id" value={parking.id} />
          <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
            <Unplug /> Disconnect camera
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

async function MonitorPageContent(props: PageProps<"/my-parking/monitor/[id]">) {
  const { id } = await props.params;
  const owned = await apiGet<OwnerParking[]>("/my-parkings");
  const parking = owned.find((p) => p.id === id);
  if (!parking) notFound();
  const source =
    parking.occupancy_source === "camera" ? "Counted by the AI camera" : parking.occupancy_source === "manual" ? "Set by hand" : "Not updated yet";

  return (
    <div className="w-full max-w-3xl">
      <AutoRefresh />
      <PageHead title="Occupancy monitoring" subtitle={parking.name} back="/my-parking" />

      {owned.length > 1 && (
        <Chips label="Select parking area" className="mb-4">
          {owned.map((p) => (
            <Link key={p.id} href={`/my-parking/monitor/${p.id}`} className={chipClass} aria-current={p.id === parking.id ? "true" : undefined}>
              {p.name}
            </Link>
          ))}
        </Chips>
      )}

      <section className={cn(surface, "overflow-hidden")} aria-label="Occupancy">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 md:px-5">
          <AvailabilityBadge parking={parking} live />
          <span className="text-xs text-muted-foreground">
            {source}
            {parking.occupancy_updated_at && ` · ${timeAgo(parking.occupancy_updated_at)}`}
          </span>
        </div>
        <div className="grid grid-cols-3 divide-x">
          <Figure label="Total capacity" value={parking.capacity} note={vehicleTypesLabel(parking.vehicle_types)} />
          <Figure label="Occupied" value={parking.occupied_spaces} note="vehicles parked" />
          <Figure label="Available" value={parking.available_spaces} note="capacity − occupied" />
        </div>
        <div className="px-4 pb-4 md:px-5">
          <OccupancyBar parking={parking} />
        </div>
      </section>

      {parking.manual_hold && (
        <Callout className="mt-4" tone="info" icon={<PenLine />} title="Your correction is in use">
          The camera resumes counting automatically as soon as the vehicles it sees change.
        </Callout>
      )}

      <SectionTitle title="Camera" />
      <CameraCard parking={parking} />

      <SectionTitle title="Correct the count" />
      <section className={cn(surface, "p-5")}>
        <ActionForm action={correctOccupancyAction} className="flex flex-col gap-4">
          <input type="hidden" name="parking_id" value={parking.id} />
          <TextField
            name="occupied_spaces"
            label="Vehicles parked right now"
            type="number"
            inputMode="numeric"
            min={0}
            max={parking.capacity}
            defaultValue={parking.occupied_spaces}
            hint={`Between 0 and ${parking.capacity}. Available spaces are worked out from this.`}
            required
          />
          <FormAlert />
          <SubmitButton pendingLabel="Saving…" block={false}>
            Update occupancy
          </SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}

/** Renders instantly with a skeleton; the data-dependent body streams in. */
export default function MonitorPage(props: PageProps<"/my-parking/monitor/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MonitorPageContent {...props} />
    </Suspense>
  );
}
