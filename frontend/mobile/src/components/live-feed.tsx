import type { ComponentType } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewProps } from "react-native-webview";

import { CctvPreview } from "@/components/ui";

const Web = WebView as unknown as ComponentType<WebViewProps>;

/**
 * Live annotated video from the Park Mandu AI detector. MJPEG plays natively inside a WebView <img>;
 * falls back to the illustrated preview when no detector is attached or the stream is unreachable.
 */
export function LiveFeed({
  streamUrl,
  label,
  offline,
  detection,
  height = 220,
}: {
  streamUrl: string | null;
  label: string;
  offline?: boolean;
  detection?: string;
  height?: number;
}) {
  if (!streamUrl || offline) {
    return <CctvPreview label={label} offline={offline} detection={detection} height={height} />;
  }
  const src = `${streamUrl.replace(/\/$/, "")}/stream.mjpg`;
  // The page reconnects by itself when the stream drops or the detector restarts.
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="margin:0;background:#1a2230;height:100vh;display:flex;align-items:center;justify-content:center;position:relative">
<p id="msg" style="position:absolute;color:rgba(255,255,255,.7);font:14px sans-serif;text-align:center;padding:16px">Waiting for video from the AI detector…</p>
<img id="v" style="position:relative;max-width:100%;max-height:100%;object-fit:contain">
<script>
var img=document.getElementById("v"),n=0;
function connect(){img.src="${src}?attempt="+(n++);}
img.onerror=function(){document.getElementById("msg").textContent="Connecting to the AI detector…";setTimeout(connect,3000);};
connect();
</script></body>`;

  return (
    <View style={[styles.frame, { height }]} accessibilityLabel={`Live video from camera ${label}`}>
      <Web
        source={{ html, baseUrl: streamUrl }}
        style={styles.web}
        scrollEnabled={false}
        originWhitelist={["*"]}
        mixedContentMode="always"
        javaScriptEnabled
      />
      <View style={styles.badge} pointerEvents="none">
        <View style={styles.dot} />
        <Text style={styles.badgeText}>LIVE · AI</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 12, overflow: "hidden", backgroundColor: "#1a2230" },
  web: { flex: 1, backgroundColor: "#1a2230" },
  badge: { position: "absolute", top: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ff4d5a" },
  badgeText: { color: "white", fontSize: 11, letterSpacing: 1.2, fontFamily: "monospace" },
});
