import { useEffect, useMemo, useRef, type ComponentType, type RefAttributes } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";

import { KATHMANDU, MAP_STYLE } from "@/lib/config";
import { usePalette } from "@/lib/theme";
import type { MarkerTone } from "@/lib/types";

// react-native-webview types its class as WebView<P = undefined>; TS 6 collapses `Props & undefined` to never.
type WebViewRef = WebView<object>;
const Web = WebView as unknown as ComponentType<WebViewProps & RefAttributes<WebViewRef>>;

export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  tone: MarkerTone;
  kind: "parking" | "pending" | "rejected" | "camera" | "incident";
  title: string;
  subtitle?: string;
  offline?: boolean;
}

type Coords = { latitude: number; longitude: number };

/**
 * OpenFreeMap vector map rendered by MapLibre GL inside a WebView — the same renderer and style as the
 * web app, and it runs in Expo Go without a native map SDK.
 */
export function MapView({
  points,
  me,
  center,
  zoom = 13,
  height = 320,
  fit = true,
  pin,
  onSelect,
  onPick,
  style,
}: {
  points: MapPoint[];
  me?: Coords | null;
  center?: Coords;
  zoom?: number;
  height?: number;
  fit?: boolean;
  /** Draggable pin for picking a location (application step 1). */
  pin?: Coords | null;
  onSelect?: (point: MapPoint) => void;
  onPick?: (coords: Coords) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<WebViewRef>(null);
  const ready = useRef(false);
  const start = center ?? pin ?? KATHMANDU;
  const picker = !!onPick;
  const initialZoom = pin ? 16 : zoom;
  // The page is built once per starting viewport; later changes are pushed in via window.render().
  const { latitude: startLat, longitude: startLng } = start;
  const { dark } = usePalette();
  const html = useMemo(() => buildHtml({ latitude: startLat, longitude: startLng }, initialZoom, picker, dark), [startLat, startLng, initialZoom, picker, dark]);
  const payload = JSON.stringify({ points, me: me ?? null, pin: pin ?? null, fit: fit && !center && !pin });

  useEffect(() => {
    if (ready.current) ref.current?.injectJavaScript(`window.render(${payload}); true;`);
  }, [payload]);

  const onMessage = (event: WebViewMessageEvent) => {
    const msg = JSON.parse(event.nativeEvent.data) as { type: string; id?: string; latitude?: number; longitude?: number };
    if (msg.type === "ready") {
      ready.current = true;
      ref.current?.injectJavaScript(`window.render(${payload}); true;`);
    } else if (msg.type === "select" && msg.id) {
      const point = points.find((p) => p.id === msg.id);
      if (point) onSelect?.(point);
    } else if (msg.type === "pick" && msg.latitude !== undefined && msg.longitude !== undefined) {
      onPick?.({ latitude: msg.latitude, longitude: msg.longitude });
    }
  };

  return (
    <View style={[styles.frame, { height }, style]} accessibilityLabel="Map of Kathmandu Valley">
      <Web
        ref={ref}
        originWhitelist={["*"]}
        source={{ html }}
        onMessage={onMessage}
        javaScriptEnabled
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        style={{ backgroundColor: "#f3f2f0" }}
      />
    </View>
  );
}

function buildHtml(center: Coords, zoom: number, picker: boolean, dark: boolean): string {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
  html,body,#map{margin:0;height:100%;width:100%;background:#f3f2f0;font-family:-apple-system,Roboto,sans-serif}
  .m{border:0;background:transparent;padding:0}
  .pin{width:28px;height:28px;border:2px solid #fff;border-radius:9px;display:grid;place-items:center;box-shadow:0 1px 2px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.14);color:#fff;font:700 13px sans-serif}
  .round{border-radius:50%;width:26px;height:26px}
  ${dark ? ".maplibregl-canvas{filter:invert(1) hue-rotate(180deg) brightness(.88) contrast(.92) saturate(.6)}" : ""}
  .green{background:#0fa05c}.blue{background:#1f5ed9}.gray{background:#8b8e94}.red{background:#d0252a}.amber{background:#f2ab35}
  .camera{background:#2b2e35}.camera.off{background:#8b8e94}.incident{background:#d0252a}
  .me{width:16px;height:16px;border-radius:50%;background:#1f5ed9;border:3px solid #fff;box-shadow:0 0 0 6px rgba(31,94,217,.22)}
  .maplibregl-popup-content{border-radius:12px;padding:10px 12px;box-shadow:0 0 0 1px #e4e3e0,0 12px 32px rgba(0,0,0,.14)}
  .maplibregl-popup-tip{display:none}
  .pop b{display:block;font-size:13px;color:#111419}.pop i{display:block;font-style:normal;font-size:12px;color:#5d6067;margin:2px 0 6px}.pop a{font-size:12px;font-weight:600;color:#1346ab}
</style></head><body><div id="map"></div><script>
  const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
  const map = new maplibregl.Map({ container: 'map', style: ${JSON.stringify(MAP_STYLE)}, center: [${center.longitude}, ${center.latitude}], zoom: ${zoom}, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  let markers = [];
  let pinMarker = null;
  function el(p) {
    const b = document.createElement('button'); b.className = 'm';
    const s = document.createElement('div');
    const tone = p.kind === 'camera' ? 'camera' + (p.offline ? ' off' : '') : p.kind === 'incident' ? 'incident' : p.tone;
    s.className = 'pin ' + tone + (p.kind === 'camera' || p.kind === 'incident' ? ' round' : '');
    const g = document.createElement('span'); g.textContent = p.kind === 'camera' ? '◉' : p.kind === 'incident' ? '!' : 'P';
    s.appendChild(g); b.appendChild(s); return b;
  }
  function popup(p) {
    const d = document.createElement('div'); d.className = 'pop';
    const t = document.createElement('b'); t.textContent = p.title; d.appendChild(t);
    if (p.subtitle) { const s = document.createElement('i'); s.textContent = p.subtitle; d.appendChild(s); }
    const a = document.createElement('a'); a.href = '#'; a.textContent = 'View details →';
    a.onclick = (e) => { e.preventDefault(); post({ type: 'select', id: p.id }); }; d.appendChild(a);
    return d;
  }
  window.render = function (data) {
    markers.forEach((m) => m.remove()); markers = [];
    data.points.forEach((p) => {
      const pop = new maplibregl.Popup({ offset: 20, closeButton: false }).setDOMContent(popup(p));
      const round = p.kind === 'camera' || p.kind === 'incident';
      markers.push(new maplibregl.Marker({ element: el(p), anchor: round ? 'center' : 'bottom' }).setLngLat([p.longitude, p.latitude]).setPopup(pop).addTo(map));
    });
    if (data.me) { const e = document.createElement('div'); e.className = 'me'; markers.push(new maplibregl.Marker({ element: e }).setLngLat([data.me.longitude, data.me.latitude]).addTo(map)); }
    if (data.pin) { setPin(data.pin.latitude, data.pin.longitude, false); }
    if (data.fit && data.points.length > 1) {
      const b = new maplibregl.LngLatBounds(); data.points.forEach((p) => b.extend([p.longitude, p.latitude]));
      if (data.me) b.extend([data.me.longitude, data.me.latitude]);
      map.fitBounds(b, { padding: 40, maxZoom: 15, duration: 0 });
    }
  };
  function setPin(lat, lng, fly) {
    if (!pinMarker) {
      pinMarker = new maplibregl.Marker({ color: '#1f5ed9', draggable: true });
      pinMarker.on('dragend', () => { const l = pinMarker.getLngLat(); post({ type: 'pick', latitude: l.lat, longitude: l.lng }); });
    }
    pinMarker.setLngLat([lng, lat]).addTo(map);
    if (fly) map.flyTo({ center: [lng, lat], zoom: 17 });
  }
  ${picker ? "map.on('click', (e) => { setPin(e.lngLat.lat, e.lngLat.lng, false); post({ type: 'pick', latitude: e.lngLat.lat, longitude: e.lngLat.lng }); });" : ""}
  map.on('load', () => post({ type: 'ready' }));
</script></body></html>`;
}

const styles = StyleSheet.create({
  frame: { borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "#e4e3e0", backgroundColor: "#f3f2f0" },
});
