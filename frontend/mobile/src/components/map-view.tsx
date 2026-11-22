import { useEffect, useMemo, useRef, type ComponentType, type RefAttributes } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import * as SecureStore from "expo-secure-store";
import { WebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";

import { KATHMANDU, MAP_STYLE, SATELLITE_STYLE, type BaseLayer } from "@/lib/config";
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

// The standard / satellite choice is shared by every map and remembered between launches.
const LAYER_KEY = "map-base-layer";
let preferredLayer: BaseLayer = "standard";
SecureStore.getItemAsync(LAYER_KEY)
  .then((stored) => {
    if (stored === "satellite") preferredLayer = "satellite";
  })
  .catch(() => {
    // No secure storage (web preview): the choice lasts for this session only.
  });

function rememberLayer(layer: BaseLayer) {
  preferredLayer = layer;
  SecureStore.setItemAsync(LAYER_KEY, layer).catch(() => {});
}

/**
 * OpenFreeMap vector map rendered by MapLibre GL inside a WebView — the same renderer and style as the
 * web app, and it runs in Expo Go without a native map SDK. A button under the zoom controls switches
 * between the standard map and satellite imagery; markers are DOM elements, so they survive the switch.
 */
export function MapView({
  points,
  me,
  center,
  zoom = 13,
  height = 320,
  fill = false,
  fit = true,
  fitCount,
  pin,
  selectedId,
  selectOnTap = false,
  bottomPadding = 0,
  recenterKey,
  onSelect,
  onDeselect,
  onPick,
  style,
  route,
  routeFitKey,
  follow = false,
}: {
  points: MapPoint[];
  me?: Coords | null;
  center?: Coords;
  zoom?: number;
  height?: number;
  /** Fill the parent instead of using a fixed height (full-screen maps). */
  fill?: boolean;
  fit?: boolean;
  /** Frame only the first N points (they arrive nearest first) together with the user's position. */
  fitCount?: number;
  /** Draggable pin for picking a location (application step 1). */
  pin?: Coords | null;
  /** Marker drawn enlarged; the map moves to it when it changes. */
  selectedId?: string | null;
  /** Report a marker tap straight away instead of opening a popup with a "View details" link. */
  selectOnTap?: boolean;
  /** Height in pixels covered at the bottom (a sheet), so framing keeps markers above it. */
  bottomPadding?: number;
  /** Change this value to move the map back to the user's position. */
  recenterKey?: number;
  onSelect?: (point: MapPoint) => void;
  onDeselect?: () => void;
  onPick?: (coords: Coords) => void;
  style?: StyleProp<ViewStyle>;
  /** Navigation route as [lng, lat] pairs; drawn on the map and kept across standard/satellite switches. */
  route?: [number, number][] | null;
  /** Change to frame the whole route once (a new route). */
  routeFitKey?: number;
  /** Keep the user's position in view as it moves (while navigating). */
  follow?: boolean;
}) {
  const ref = useRef<WebViewRef>(null);
  const ready = useRef(false);
  const start = center ?? pin ?? KATHMANDU;
  const picker = !!onPick;
  const initialZoom = pin ? 16 : zoom;
  // The page is built once per starting viewport; later changes are pushed in via window.render().
  const { latitude: startLat, longitude: startLng } = start;
  const { dark } = usePalette();
  const html = useMemo(
    // The layer is read when the page is built; switching later happens inside the page.
    () => buildHtml({ latitude: startLat, longitude: startLng }, initialZoom, picker, dark, selectOnTap, preferredLayer),
    [startLat, startLng, initialZoom, picker, dark, selectOnTap],
  );
  // The view is only re-framed when the set of markers (or having a position at all) changes, so
  // selecting a marker or a moving position dot never throws away where the user panned to.
  const fitKey = `${points.map((p) => p.id).join(",")}|${me ? "me" : ""}`;
  const payload = JSON.stringify({
    points,
    me: me ?? null,
    pin: pin ?? null,
    fit: fit && !center && !pin,
    fitKey,
    fitCount: fitCount ?? null,
    selected: selectedId ?? null,
    bottom: bottomPadding,
    recenter: recenterKey ?? 0,
    route: route ?? null,
    routeFit: routeFitKey ?? 0,
    follow,
  });

  useEffect(() => {
    if (ready.current) ref.current?.injectJavaScript(`window.render(${payload}); true;`);
  }, [payload]);

  const onMessage = (event: WebViewMessageEvent) => {
    const msg = JSON.parse(event.nativeEvent.data) as { type: string; id?: string; latitude?: number; longitude?: number; layer?: BaseLayer };
    if (msg.type === "ready") {
      ready.current = true;
      ref.current?.injectJavaScript(`window.render(${payload}); true;`);
    } else if (msg.type === "select" && msg.id) {
      const point = points.find((p) => p.id === msg.id);
      if (point) onSelect?.(point);
    } else if (msg.type === "blank") {
      onDeselect?.();
    } else if (msg.type === "pick" && msg.latitude !== undefined && msg.longitude !== undefined) {
      onPick?.({ latitude: msg.latitude, longitude: msg.longitude });
    } else if (msg.type === "layer" && (msg.layer === "standard" || msg.layer === "satellite")) {
      rememberLayer(msg.layer);
    }
  };

  return (
    <View style={[fill ? styles.fill : [styles.frame, { height }], style]} accessibilityLabel="Map of Kathmandu Valley">
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

function buildHtml(center: Coords, zoom: number, picker: boolean, dark: boolean, selectOnTap: boolean, layer: BaseLayer): string {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
  html,body,#map{margin:0;height:100%;width:100%;background:#f3f2f0;font-family:-apple-system,Roboto,sans-serif}
  .m{border:0;background:transparent;padding:6px;margin:-6px}
  .pin{position:relative;width:28px;height:28px;border:2px solid #fff;border-radius:9px;display:grid;place-items:center;box-shadow:0 1px 2px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.14);color:#fff;font:700 13px sans-serif;transition:transform .12s}
  .round{border-radius:50%;width:26px;height:26px}
  ${dark ? "body:not(.sat) .maplibregl-canvas{filter:invert(1) hue-rotate(180deg) brightness(.88) contrast(.92) saturate(.6)}" : ""}
  .layer{position:absolute;top:84px;right:10px;z-index:3;width:29px;height:29px;border:0;border-radius:4px;background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.1);display:grid;place-items:center;padding:0;color:#333}
  .layer svg{width:17px;height:17px}
  body.sat .layer{background:#1f5ed9;color:#fff}
  .green{background:#0fa05c}.blue{background:#1f5ed9}.amber{background:#f2ab35}
  /* Unavailable parking steps back; proposed parking is an outline, not a solid pin. */
  .red{background:#d0252a;width:22px;height:22px;border-radius:7px;font-size:11px;opacity:.9}
  .gray{background:#fff;color:#7d8088;border:2px dashed #a2a4ab;box-shadow:none}
  /* Government parking carries a small verified tick. */
  .blue::after{content:'✓';position:absolute;right:-7px;top:-7px;width:14px;height:14px;border-radius:50%;background:#fff;color:#1f5ed9;font:700 9px/14px sans-serif;text-align:center;box-shadow:0 0 0 1px #1f5ed9}
  .camera{background:#2b2e35}.camera.off{background:#8b8e94}.incident{background:#d0252a}
  .sel .pin{transform:scale(1.35);box-shadow:0 0 0 4px rgba(114,62,230,.35),0 6px 14px rgba(0,0,0,.25);opacity:1}
  .me{width:16px;height:16px;border-radius:50%;background:#1f5ed9;border:3px solid #fff;box-shadow:0 0 0 6px rgba(31,94,217,.22)}
  .maplibregl-popup-content{border-radius:12px;padding:10px 12px;box-shadow:0 0 0 1px #e4e3e0,0 12px 32px rgba(0,0,0,.14)}
  .maplibregl-popup-tip{display:none}
  .pop b{display:block;font-size:13px;color:#111419}.pop i{display:block;font-style:normal;font-size:12px;color:#5d6067;margin:2px 0 6px}.pop a{font-size:12px;font-weight:600;color:#1346ab}
</style></head><body${layer === "satellite" ? ' class="sat"' : ""}><div id="map"></div>
<button class="layer" id="layer" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg></button><script>
  const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
  const SELECT_ON_TAP = ${selectOnTap ? "true" : "false"};
  const STYLES = { standard: ${JSON.stringify(MAP_STYLE)}, satellite: ${JSON.stringify(SATELLITE_STYLE)} };
  let layer = ${JSON.stringify(layer)};
  const layerButton = document.getElementById('layer');
  function labelLayer() {
    const next = layer === 'satellite' ? 'standard map' : 'satellite view';
    layerButton.setAttribute('aria-label', 'Switch to ' + next); layerButton.title = 'Switch to ' + next;
    layerButton.setAttribute('aria-pressed', layer === 'satellite' ? 'true' : 'false');
  }
  labelLayer();
  layerButton.addEventListener('click', (e) => {
    e.stopPropagation();
    layer = layer === 'satellite' ? 'standard' : 'satellite';
    map.setStyle(STYLES[layer]);
    // setStyle drops every layer that is not part of the style: draw the route again once it is ready.
    map.once('style.load', () => drawRoute(lastRoute));
    document.body.classList.toggle('sat', layer === 'satellite');
    labelLayer();
    post({ type: 'layer', layer: layer });
  });
  const map = new maplibregl.Map({ container: 'map', style: STYLES[layer], center: [${center.longitude}, ${center.latitude}], zoom: ${zoom}, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  let markers = [];
  let byId = {};
  let pinMarker = null;
  let lastFitKey = null, lastSelected = null, lastRecenter = 0, lastRoute = null, lastRouteFit = 0;
  function drawRoute(coords) {
    if (!map.isStyleLoaded()) { map.once('style.load', () => drawRoute(lastRoute)); return; }
    const data = coords && coords.length > 1
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
      : { type: 'FeatureCollection', features: [] };
    const src = map.getSource('pm-route');
    if (src) { src.setData(data); return; }
    map.addSource('pm-route', { type: 'geojson', data: data });
    map.addLayer({ id: 'pm-route-casing', type: 'line', source: 'pm-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
    map.addLayer({ id: 'pm-route-line', type: 'line', source: 'pm-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1f5ed9', 'line-width': 5 } });
  }
  function el(p) {
    const b = document.createElement('button'); b.className = 'm';
    b.setAttribute('aria-label', p.title + (p.subtitle ? ', ' + p.subtitle : ''));
    const s = document.createElement('div');
    const tone = p.kind === 'camera' ? 'camera' + (p.offline ? ' off' : '') : p.kind === 'incident' ? 'incident' : p.tone;
    s.className = 'pin ' + tone + (p.kind === 'camera' || p.kind === 'incident' ? ' round' : '');
    const g = document.createElement('span'); g.textContent = p.kind === 'camera' ? '◉' : p.kind === 'incident' ? '!' : 'P';
    s.appendChild(g); b.appendChild(s);
    if (SELECT_ON_TAP) b.addEventListener('click', (e) => { e.stopPropagation(); post({ type: 'select', id: p.id }); });
    return b;
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
    const pad = { top: 70, bottom: 40 + (data.bottom || 0), left: 40, right: 40 };
    markers.forEach((m) => m.remove()); markers = []; byId = {};
    data.points.forEach((p) => {
      const round = p.kind === 'camera' || p.kind === 'incident';
      const node = el(p);
      if (p.id === data.selected) node.classList.add('sel');
      const marker = new maplibregl.Marker({ element: node, anchor: round ? 'center' : 'bottom' }).setLngLat([p.longitude, p.latitude]);
      if (!SELECT_ON_TAP) marker.setPopup(new maplibregl.Popup({ offset: 20, closeButton: false }).setDOMContent(popup(p)));
      marker.addTo(map);
      if (p.id === data.selected) node.style.zIndex = '5';
      markers.push(marker); byId[p.id] = p;
    });
    if (data.me) { const e = document.createElement('div'); e.className = 'me'; markers.push(new maplibregl.Marker({ element: e }).setLngLat([data.me.longitude, data.me.latitude]).addTo(map)); }
    if (data.pin) { setPin(data.pin.latitude, data.pin.longitude, false); }

    if (data.recenter !== lastRecenter) {
      lastRecenter = data.recenter;
      if (data.me) map.easeTo({ center: [data.me.longitude, data.me.latitude], zoom: Math.max(map.getZoom(), 15), padding: pad, duration: 400 });
    } else if (data.selected && data.selected !== lastSelected && byId[data.selected]) {
      const s = byId[data.selected];
      map.easeTo({ center: [s.longitude, s.latitude], zoom: Math.max(map.getZoom(), 15), padding: pad, duration: 350 });
    } else if (data.fit && data.fitKey !== lastFitKey && data.points.length > 0) {
      const b = new maplibregl.LngLatBounds();
      (data.fitCount ? data.points.slice(0, data.fitCount) : data.points).forEach((p) => b.extend([p.longitude, p.latitude]));
      if (data.me) b.extend([data.me.longitude, data.me.latitude]);
      if (data.points.length > 1 || data.me) map.fitBounds(b, { padding: pad, maxZoom: 15, duration: 0 });
    }
    lastSelected = data.selected;
    lastFitKey = data.fitKey;

    lastRoute = data.route;
    drawRoute(data.route);
    if (data.route && data.route.length > 1 && data.routeFit !== lastRouteFit) {
      lastRouteFit = data.routeFit;
      const rb = new maplibregl.LngLatBounds();
      data.route.forEach((c) => rb.extend(c));
      map.fitBounds(rb, { padding: pad, maxZoom: 17, duration: 500 });
    } else if (data.follow && data.me) {
      const b = map.getBounds(), w = b.getEast() - b.getWest(), h = b.getNorth() - b.getSouth();
      const m = data.me;
      if (m.longitude < b.getWest() + w * 0.15 || m.longitude > b.getEast() - w * 0.15 || m.latitude < b.getSouth() + h * 0.2 || m.latitude > b.getNorth() - h * 0.15) {
        map.easeTo({ center: [m.longitude, m.latitude], padding: pad, duration: 500 });
      }
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
  // Marker taps stop at the marker, so a click that reaches the map is a tap on empty map.
  if (SELECT_ON_TAP) map.on('click', () => post({ type: 'blank' }));
  map.on('load', () => post({ type: 'ready' }));
</script></body></html>`;
}

const styles = StyleSheet.create({
  frame: { borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "#e4e3e0", backgroundColor: "#f3f2f0" },
  fill: { flex: 1, backgroundColor: "#f3f2f0" },
});
