import { useMemo, type ComponentType } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewProps } from "react-native-webview";

import { TRAFFIC } from "@/lib/format";
import { useApi } from "@/lib/queries";
import { colors, fonts, radius, usePalette } from "@/lib/theme";
import type { CameraTrackingState, TrackStatus } from "@/lib/types";

import { Badge, Card, CctvPreview, Row, Txt } from "./ui";

// react-native-webview types its class as WebView<P = undefined>; TS 6 collapses `Props & undefined` to never.
const Web = WebView as unknown as ComponentType<WebViewProps>;

const TRACK_STATUS: Record<TrackStatus, { label: string; tone: "success" | "warning" | "danger" }> = {
  moving: { label: "Moving", tone: "success" },
  stopped: { label: "Stopped", tone: "warning" },
  parked: { label: "Parked", tone: "danger" },
};

/**
 * The page shown inside the WebView: the detector's MJPEG stream in an <img>, reopened every few
 * seconds while it cannot be loaded. The detector draws the boxes and track IDs into the video.
 */
function streamPage(streamUrl: string): string {
  const source = JSON.stringify(`${streamUrl.replace(/\/$/, "")}/stream.mjpg`);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<style>
  html,body{margin:0;height:100%;background:#1a2230;overflow:hidden;font:500 12px -apple-system,Roboto,sans-serif;color:rgba(255,255,255,.85)}
  img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none}
  p{position:absolute;inset:0;margin:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 24px}
</style></head><body><p id="wait">Waiting for video from the AI detector…</p><img id="video" alt="" /><script>
  var video = document.getElementById('video'), wait = document.getElementById('wait'), attempt = 0;
  function open() { video.src = ${source} + '?attempt=' + (attempt++); }
  video.onload = function () { video.style.display = 'block'; wait.style.display = 'none'; };
  video.onerror = function () { video.style.display = 'none'; wait.style.display = 'flex'; setTimeout(open, 3000); };
  open();
</script></body></html>`;
}

/**
 * Camera view for the police app. Cameras with an AI detector play its annotated video; simulated
 * cameras keep the drawn placeholder scene.
 */
export function LiveFeed({
  streamUrl,
  aiEnabled,
  label,
  offline,
  detection,
  height = 220,
}: {
  streamUrl: string | null;
  aiEnabled: boolean;
  label: string;
  offline?: boolean;
  detection?: string;
  height?: number;
}) {
  const html = useMemo(() => (streamUrl ? streamPage(streamUrl) : null), [streamUrl]);
  if (!aiEnabled) return <CctvPreview label={label} offline={offline} detection={detection} height={height} />;

  return (
    <View style={[styles.frame, { height }]} accessibilityLabel={`Live AI video, ${label}${offline ? ", offline" : ""}`} accessibilityRole="image">
      {html && !offline ? (
        <Web
          originWhitelist={["*"]}
          source={{ html }}
          javaScriptEnabled
          scrollEnabled={false}
          mixedContentMode="always"
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
          style={{ backgroundColor: "#1a2230" }}
        />
      ) : (
        <View style={styles.message}>
          <Text style={styles.messageText}>{offline ? "AI DETECTOR OFFLINE" : "This detector runs without a video preview"}</Text>
        </View>
      )}
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.tag}>
          {!offline && <View style={styles.dot} />}
          <Text style={styles.mono}>{offline ? "NO SIGNAL" : "LIVE · AI TRACKING"}</Text>
        </View>
        <View style={styles.tag}>
          <Text style={styles.mono}>{label}</Text>
        </View>
      </View>
    </View>
  );
}

function Figure({ label, value, note }: { label: string; value: string | number; note?: string }) {
  const p = usePalette();
  return (
    <View style={[styles.figure, { borderColor: p.border, backgroundColor: p.surface }]}>
      <Txt variant="small">{label}</Txt>
      <Txt variant="h1" style={{ fontSize: 20, lineHeight: 26, fontVariant: ["tabular-nums"] }}>
        {value}
      </Txt>
      {note && (
        <Txt variant="small" style={{ fontSize: 11 }}>
          {note}
        </Txt>
      )}
    </View>
  );
}

function standing(seconds: number): string {
  if (seconds < 1) return "";
  return seconds < 60 ? `standing ${Math.round(seconds)} s` : `standing ${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

/** Vehicle counts, measured traffic and the tracked vehicles of an AI camera, refreshed every two seconds. */
export function LiveTracking({ cameraId }: { cameraId: string }) {
  const p = usePalette();
  const query = useApi<CameraTrackingState>(`/cameras/${cameraId}/tracking`, undefined, { refetchInterval: 2000 });
  const tracking = query.data?.tracking;

  if (!query.data || !tracking) {
    return (
      <Card style={{ marginTop: 12 }}>
        <Txt variant="muted">
          {query.isPending ? "Loading live tracking…" : "No live tracking right now. Vehicle counts appear here while the AI detector for this camera is running."}
        </Txt>
      </Card>
    );
  }
  const measured = tracking.avg_speed_kmh !== null;
  const classes = Object.entries(tracking.counts_by_class)
    .map(([name, count]) => `${count} ${name.toLowerCase()}`)
    .join(" · ");

  return (
    <View style={{ marginTop: 12, gap: 12 }} accessibilityLabel="Live vehicle tracking">
      <View style={styles.figures}>
        <Figure label="In view" value={tracking.vehicle_count} note={`${tracking.moving_count} moving`} />
        <Figure label="Stopped" value={tracking.stopped_count} />
        <Figure label="Parked" value={tracking.parked_count} />
        <Figure label="Flow / min" value={tracking.flow_per_minute} />
        <Figure label="Avg speed" value={measured ? `${Math.round(tracking.avg_speed_kmh!)} km/h` : "—"} note={measured ? "Measured" : "Not calibrated"} />
        <View style={[styles.figure, { borderColor: p.border, backgroundColor: p.surface, gap: 4 }]}>
          <Txt variant="small">Traffic</Txt>
          <Badge tone={TRAFFIC[query.data.traffic_level].tone}>{TRAFFIC[query.data.traffic_level].label}</Badge>
          <Txt variant="small" style={{ fontSize: 11 }}>
            {measured ? "From speed" : "Last known"}
          </Txt>
        </View>
      </View>

      <Card style={{ paddingVertical: 4 }}>
        <Row style={{ justifyContent: "space-between", paddingVertical: 10 }}>
          <Txt variant="h3">Tracked vehicles</Txt>
          <Txt variant="small" numberOfLines={1} style={{ flexShrink: 1, textAlign: "right" }}>
            {classes || "none"}
          </Txt>
        </Row>
        {tracking.tracks.length ? (
          tracking.tracks.map((t) => (
            <Row key={t.track_id} style={[styles.track, { borderTopColor: p.border }]}>
              <Text style={[styles.trackId, { color: p.heading }]}>#{t.track_id}</Text>
              <View style={{ flex: 1 }}>
                <Txt variant="label">{t.vehicle_type}</Txt>
                <Txt variant="small">
                  {[t.speed_kmh === null ? null : `${Math.round(t.speed_kmh)} km/h`, standing(t.stopped_seconds) || null, `${Math.round(t.confidence * 100)}%`].filter(Boolean).join(" · ")}
                </Txt>
              </View>
              <Badge tone={TRACK_STATUS[t.status].tone}>{TRACK_STATUS[t.status].label}</Badge>
            </Row>
          ))
        ) : (
          <Txt variant="muted" style={{ paddingVertical: 14, textAlign: "center" }}>
            No vehicles in view.
          </Txt>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.md, overflow: "hidden", backgroundColor: "#1a2230" },
  overlay: { position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", justifyContent: "space-between" },
  tag: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ff4d5a" },
  mono: { color: "rgba(255,255,255,0.92)", fontSize: 10, fontFamily: fonts.mono },
  message: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  messageText: { color: "rgba(255,255,255,0.9)", fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1.6, textAlign: "center" },
  figures: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  figure: { flexBasis: "30%", flexGrow: 1, borderWidth: 1, borderRadius: radius.sm, padding: 10 },
  track: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  trackId: { width: 46, fontFamily: fonts.mono, fontSize: 13, color: colors.slate950 },
});
