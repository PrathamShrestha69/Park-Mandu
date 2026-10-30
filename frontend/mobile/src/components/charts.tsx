import { StyleSheet, View } from "react-native";

import { colors } from "@/lib/theme";

import { Row, Txt } from "./ui";

/** Grouped vertical bars (e.g. applications submitted vs approved per month). */
export function BarChart({ data, series }: { data: { label: string; values: number[] }[]; series: { name: string; color: string }[] }) {
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  return (
    <View accessibilityRole="image" accessibilityLabel={data.map((d) => `${d.label}: ${d.values.join(" / ")}`).join(", ")}>
      <Row gap={12} style={{ marginBottom: 10 }}>
        {series.map((s) => (
          <Row key={s.name} gap={5}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <Txt variant="small">{s.name}</Txt>
          </Row>
        ))}
      </Row>
      <View style={styles.plot}>
        {data.map((d) => (
          <View key={d.label} style={styles.group}>
            <View style={styles.bars}>
              {d.values.map((v, i) => (
                <View key={i} style={[styles.bar, { height: `${Math.max(3, (v / max) * 100)}%`, backgroundColor: series[i].color }]} />
              ))}
            </View>
            <Txt variant="small" style={{ fontSize: 11 }}>
              {d.label}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Horizontal ranked bars (e.g. incidents by area). */
export function RankBars({ data, color = colors.red500 }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ gap: 12 }}>
      {data.map((d) => (
        <View key={d.label} style={{ gap: 4 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Txt variant="small">{d.label}</Txt>
            <Txt variant="label">{d.value}</Txt>
          </Row>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${(d.value / max) * 100}%`, backgroundColor: color }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Stacked share bar with legend (approved / rejected / changes requested). */
export function ShareBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.track, { height: 14, flexDirection: "row" }]}>
        {parts.map((p) => (
          <View key={p.label} style={{ flex: Math.max(p.value, 0.0001), backgroundColor: p.color }} />
        ))}
      </View>
      {parts.map((p) => (
        <Row key={p.label} style={{ justifyContent: "space-between" }}>
          <Row gap={6}>
            <View style={[styles.dot, { backgroundColor: p.color }]} />
            <Txt variant="muted">{p.label}</Txt>
          </Row>
          <Txt variant="label">
            {p.value} · {total ? Math.round((p.value / total) * 100) : 0}%
          </Txt>
        </Row>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 9, height: 9, borderRadius: 5 },
  plot: { height: 150, flexDirection: "row", alignItems: "flex-end", gap: 8 },
  group: { flex: 1, alignItems: "center", gap: 6, height: "100%" },
  bars: { flex: 1, width: "100%", flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 3 },
  bar: { width: 10, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  track: { height: 8, borderRadius: 6, backgroundColor: colors.slate100, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 6 },
});
