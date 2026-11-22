import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Animated, PanResponder, StyleSheet, View } from "react-native";

import { radius, shadow, usePalette } from "@/lib/theme";

/**
 * Sheet pinned to the bottom of its parent that snaps between fixed heights. Only the header is
 * draggable, so lists inside the sheet scroll normally. Tapping the header steps to the next height.
 */
export function BottomSheet({
  snapPoints,
  index,
  onIndexChange,
  header,
  children,
}: {
  /** Heights in pixels, smallest first. */
  snapPoints: number[];
  index: number;
  onIndexChange: (index: number) => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const p = usePalette();
  const target = snapPoints[Math.min(index, snapPoints.length - 1)];
  const [height] = useState(() => new Animated.Value(target));

  useEffect(() => {
    Animated.spring(height, { toValue: target, useNativeDriver: false, bounciness: 0, speed: 18 }).start();
  }, [height, target]);

  const pan = useMemo(() => {
    const points = snapPoints;
    const current = Math.min(index, points.length - 1);
    const start = points[current];
    return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderMove: (_, g) => {
          height.setValue(Math.max(points[0], Math.min(points[points.length - 1], start - g.dy)));
        },
        onPanResponderRelease: (_, g) => {
          let next: number;
          if (Math.abs(g.dy) < 6) {
            // A tap: open one step, or collapse from the top.
            next = current >= points.length - 1 ? 0 : current + 1;
          } else {
            // A drag: settle on the nearest height, nudged in the direction of a quick flick.
            const reached = start - g.dy - g.vy * 120;
            next = points.reduce((best, point, i) => (Math.abs(point - reached) < Math.abs(points[best] - reached) ? i : best), 0);
          }
          if (next === current) {
            Animated.spring(height, { toValue: points[current], useNativeDriver: false, bounciness: 0, speed: 18 }).start();
          } else {
            onIndexChange(next);
          }
        },
      });
  }, [height, snapPoints, index, onIndexChange]);

  return (
    <Animated.View style={[styles.sheet, { height, backgroundColor: p.surface, borderColor: p.border }]}>
      <View {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Parking list. Drag or tap to resize." accessibilityHint="Shows more or less of the list">
        <View style={styles.grip}>
          <View style={[styles.handle, { backgroundColor: p.input }]} />
        </View>
        {header}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: "hidden",
    ...shadow,
    elevation: 12,
  },
  grip: { alignItems: "center", paddingTop: 8, paddingBottom: 6 },
  handle: { width: 40, height: 4, borderRadius: 2 },
});
