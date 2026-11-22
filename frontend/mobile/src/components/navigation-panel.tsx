import { CircleCheck, CornerUpRight, LocateFixed, Navigation, RefreshCw, Square, WifiOff, X } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { Button, Row, Txt } from "@/components/ui";
import { GPS_MESSAGES, formatRouteDistance, formatTravelTime } from "@/lib/navigation";
import { colors, radius } from "@/lib/theme";
import type { useParkingNavigation } from "@/lib/use-navigation";

type Nav = ReturnType<typeof useParkingNavigation>;

function Notice({ icon, tone, children, action }: { icon: React.ReactNode; tone: "warn" | "danger" | "info"; children: string; action?: React.ReactNode }) {
  const bg = tone === "danger" ? colors.red50 : tone === "warn" ? "#fff6e5" : colors.blue50;
  const fg = tone === "danger" ? colors.red700 : tone === "warn" ? "#8a5300" : colors.blue700;
  return (
    <View style={[styles.notice, { backgroundColor: bg }]} accessibilityRole="alert">
      {icon}
      <Txt variant="small" color={fg} style={{ flex: 1 }}>
        {children}
      </Txt>
      {action}
    </View>
  );
}

/** Directions to the selected parking, inside the map screen. The route itself is drawn by MapView. */
export function NavigationPanel({ nav, name, onClose }: { nav: Nav; name: string; onClose: () => void }) {
  const { phase, route, gps, routeError, offline, routing } = nav;
  const next = route ? (route.steps[1] ?? route.steps[0]) : null;
  const close = () => {
    nav.clear();
    onClose();
  };

  return (
    <View style={{ gap: 12 }}>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="small">{phase === "navigating" ? "Navigating to" : "Directions to"}</Txt>
          <Txt variant="h2" numberOfLines={1}>
            {name}
          </Txt>
        </View>
        <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close directions" style={styles.close}>
          <X size={18} color={colors.slate600} />
        </Pressable>
      </Row>

      {phase === "locating" && (
        <Row gap={8}>
          <ActivityIndicator size="small" color={colors.blue600} />
          <Txt variant="muted">Finding your location…</Txt>
        </Row>
      )}

      {phase === "arrived" ? (
        <Row gap={8}>
          <CircleCheck size={20} color={colors.green700} />
          <Txt variant="h3" color={colors.green700}>
            You have arrived.
          </Txt>
        </Row>
      ) : route ? (
        <Row gap={14} style={{ alignItems: "baseline" }}>
          <Txt variant="h1">{formatTravelTime(route.duration_s)}</Txt>
          <Txt variant="label" color={colors.slate600}>
            {formatRouteDistance(route.distance_m)}
          </Txt>
          {routing && <ActivityIndicator size="small" color={colors.slate500} accessibilityLabel="Updating route" />}
        </Row>
      ) : (
        (phase === "preview" || phase === "navigating") && (
          <Row gap={8}>
            {routing && <ActivityIndicator size="small" color={colors.blue600} />}
            <Txt variant="muted">{routing ? "Finding the best route…" : "No route yet."}</Txt>
          </Row>
        )
      )}

      {phase === "navigating" && next && (
        <View style={styles.next} accessibilityLiveRegion="polite">
          <CornerUpRight size={22} color="white" />
          <View style={{ flex: 1 }}>
            <Txt variant="label" color="white" numberOfLines={2}>
              {next.instruction}
            </Txt>
            <Txt variant="small" color="rgba(255,255,255,0.75)">
              in {formatRouteDistance(next.distance_m)}
            </Txt>
          </View>
        </View>
      )}

      {gps && (
        <Notice
          tone="warn"
          icon={<LocateFixed size={16} color="#8a5300" />}
          action={phase !== "navigating" && gps !== "unsupported" ? <Button small variant="secondary" title="Try again" onPress={() => void nav.preview()} /> : undefined}
        >
          {GPS_MESSAGES[gps] + (phase === "navigating" ? " Your last position and route stay on the map." : "")}
        </Notice>
      )}
      {offline && (
        <Notice tone="info" icon={<WifiOff size={16} color={colors.blue700} />}>
          You are offline. The last route stays on the map and updates when you reconnect.
        </Notice>
      )}
      {routeError && !offline && (
        <Notice tone="danger" icon={<RefreshCw size={16} color={colors.red700} />} action={<Button small variant="secondary" title="Retry" onPress={nav.retry} />}>
          {routeError}
        </Notice>
      )}

      {phase === "idle" && <Button title="Get directions" icon={<Navigation size={18} color="white" />} onPress={() => void nav.preview()} />}
      {phase === "preview" && (
        <Button title="Start navigation" icon={<Navigation size={18} color="white" />} onPress={() => void nav.start()} disabled={!nav.me} />
      )}
      {phase === "navigating" && <Button title="Stop navigation" variant="secondary" icon={<Square size={16} color={colors.slate700} />} onPress={nav.stop} />}
      {phase === "arrived" && <Button title="Done" variant="secondary" onPress={close} />}

      {route && phase === "preview" && route.steps.length > 0 && (
        <View style={{ gap: 6 }}>
          <Txt variant="label">Turn-by-turn</Txt>
          {route.steps.map((step, i) => (
            <Row key={i} style={{ justifyContent: "space-between" }}>
              <Txt variant="small" style={{ flex: 1 }}>
                {step.instruction}
              </Txt>
              {step.distance_m > 0 && <Txt variant="small">{formatRouteDistance(step.distance_m)}</Txt>}
            </Row>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.slate100, alignItems: "center", justifyContent: "center" },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.sm },
  next: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.sm, backgroundColor: colors.blue600 },
});
