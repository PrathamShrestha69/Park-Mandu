import { router } from "expo-router";
import { ArrowLeft, CircleAlert, RefreshCw } from "lucide-react-native";
import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, fonts, radius, space, toneColors, usePalette, type Tone } from "@/lib/theme";

// --------------------------------------------------------------------------- text

type Variant = "h1" | "h2" | "h3" | "body" | "muted" | "small" | "label" | "eyebrow" | "mono";

const TEXT: Record<Variant, TextStyle> = {
  h1: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  h2: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  h3: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  eyebrow: { fontFamily: fonts.body, fontSize: 13 },
  mono: { fontFamily: fonts.mono, fontSize: 12 },
};

export function Txt({
  variant = "body",
  color,
  style,
  children,
  numberOfLines,
}: {
  variant?: Variant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  const p = usePalette();
  const base = variant.startsWith("h") ? p.heading : variant === "muted" || variant === "small" || variant === "eyebrow" ? p.textMuted : p.text;
  return (
    <Text style={[TEXT[variant], { color: color ?? base }, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

// --------------------------------------------------------------------------- layout

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  edges = ["top"],
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: ("top" | "bottom")[];
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.page }} edges={edges}>
      {scroll ? (
        // Edge-to-edge Android no longer resizes the window for the keyboard, so avoid it here on both platforms.
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.screen, contentStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={p.primary} /> : undefined}
        >
          {children}
        </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Header({
  title,
  subtitle,
  eyebrow,
  back,
  right,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  back?: boolean | string;
  right?: ReactNode;
}) {
  const p = usePalette();
  return (
    <View style={styles.header}>
      {back && (
        <IconButton
          label="Go back"
          onPress={() => (typeof back === "string" ? router.replace(back as never) : router.canGoBack() ? router.back() : router.replace("/"))}
        >
          <ArrowLeft size={20} color={p.heading} />
        </IconButton>
      )}
      <View style={{ flex: 1 }}>
        {eyebrow && (
          <Txt variant="eyebrow" style={{ marginBottom: 4 }}>
            {eyebrow}
          </Txt>
        )}
        <Txt variant="h1" numberOfLines={2}>
          {title}
        </Txt>
        {subtitle && (
          <Txt variant="muted" style={{ marginTop: 4 }}>
            {subtitle}
          </Txt>
        )}
      </View>
      {right}
    </View>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Txt variant="h2" style={{ fontSize: 15, lineHeight: 20 }}>
        {title}
      </Txt>
      {action}
    </View>
  );
}

export function Row({ children, style, gap = 10 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

/** Vertical stack with the shared 12px gap between related items. */
export function Stack({ children, gap = space.related, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

// --------------------------------------------------------------------------- surfaces

export function Card({ children, onPress, style, accessibilityLabel }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const p = usePalette();
  const base: ViewStyle = { backgroundColor: p.surface, borderColor: p.border };
  if (!onPress) return <View style={[styles.card, base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, base, pressed && { backgroundColor: p.surfaceMuted }, style]}
    >
      {children}
    </Pressable>
  );
}

export function Badge({ tone = "neutral", children, live }: { tone?: Tone; children: ReactNode; live?: boolean }) {
  const p = usePalette();
  const t = toneColors[tone];
  const fg = p.dark ? t.fgDark : t.fg;
  return (
    <View style={[styles.badge, { backgroundColor: p.dark ? t.bgDark : t.bg, borderColor: p.dark ? t.bgDark : t.border }]}>
      <View style={[styles.liveDot, { backgroundColor: fg }]} />
      <Text style={{ color: fg, fontFamily: fonts.medium, fontSize: 12 }}>{children}</Text>
    </View>
  );
}

/** Small round status dot used in legends and labels. */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function Callout({ tone = "info", title, children, icon }: { tone?: Tone; title?: string; children: ReactNode; icon?: ReactNode }) {
  const p = usePalette();
  const t = toneColors[tone];
  const fg = p.dark ? t.fgDark : t.fg;
  return (
    <View style={[styles.callout, { backgroundColor: p.dark ? t.bgDark : t.bg, borderColor: p.dark ? t.bgDark : t.bg }]}>
      {icon}
      <View style={{ flex: 1 }}>
        {title && <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: fg, marginBottom: 2 }}>{title}</Text>}
        {typeof children === "string" ? <Text style={{ fontFamily: fonts.body, color: fg, fontSize: 13, lineHeight: 19, opacity: 0.9 }}>{children}</Text> : children}
      </View>
    </View>
  );
}

export function KV({ label, value }: { label: string; value: ReactNode }) {
  const p = usePalette();
  return (
    <View style={[styles.kv, { borderBottomColor: p.border }]}>
      <Txt variant="muted">{label}</Txt>
      {typeof value === "string" || typeof value === "number" || value == null ? (
        <Txt variant="label" style={{ flexShrink: 1, textAlign: "right" }}>
          {value ?? "—"}
        </Txt>
      ) : (
        value
      )}
    </View>
  );
}

function StatIcon({ icon, color }: { icon: ReactNode; color: string }) {
  return isValidElement(icon) ? cloneElement(icon as ReactElement<{ size?: number; color?: string }>, { size: 16, color }) : icon;
}

/** Headline number. Tone is a quiet dot beside the label, not a coloured block. */
export function StatCard({ icon, tone, label, value, note, onPress }: { icon: ReactNode; tone: Tone; label: string; value: number | string; note?: string; onPress?: () => void }) {
  return (
    <Card onPress={onPress} style={{ flex: 1, minWidth: "46%" }}>
      <Row gap={10}>
        <View style={[styles.statTile, { backgroundColor: toneColors[tone].bg }]}>
          <StatIcon icon={icon} color={toneColors[tone].fg} />
        </View>
        <Txt variant="muted" numberOfLines={1} style={{ flex: 1, fontFamily: fonts.medium }}>
          {label}
        </Txt>
      </Row>
      <Txt variant="h1" style={{ fontSize: 26, lineHeight: 30, marginTop: 14, fontVariant: ["tabular-nums"] }}>
        {value}
      </Txt>
      {note && (
        <Txt variant="small" style={{ marginTop: 6 }}>
          {note}
        </Txt>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------- buttons

type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "ghost";

export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  small,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const bg: Record<ButtonVariant, string> = {
    primary: p.ink,
    secondary: p.surface,
    danger: colors.red500,
    success: p.ink,
    ghost: "transparent",
  };
  const fg: Record<ButtonVariant, string> = {
    primary: p.inkForeground,
    secondary: p.text,
    danger: colors.white,
    success: p.inkForeground,
    ghost: p.textMuted,
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg[variant] },
        variant === "secondary" && { borderWidth: 1, borderColor: p.input },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.82 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg[variant]} size="small" /> : icon}
      <Text style={{ color: fg[variant], fontFamily: fonts.semibold, fontSize: small ? 13 : 15 }}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ children, onPress, label, badge }: { children: ReactNode; onPress?: () => void; label: string; badge?: number }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? p.surfaceMuted : p.surface, borderColor: p.input }]}
    >
      {children}
      {!!badge && (
        <View style={[styles.iconBadge, { borderColor: p.page }]}>
          <Text style={{ color: "white", fontSize: 10, fontFamily: fonts.mono }}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

// --------------------------------------------------------------------------- forms

export function Field({
  label,
  error,
  hint,
  icon,
  multiline,
  onFocus,
  onBlur,
  ...input
}: { label: string; error?: string; hint?: string; icon?: ReactNode } & TextInputProps) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  const errorColor = p.dark ? "#ff8f8f" : colors.red500;
  return (
    <View style={{ gap: 8 }}>
      <Txt variant="label">{label}</Txt>
      {/* Never flattened: if this wrapper were re-created on focus, Android would hand focus to the next input in a loop. */}
      <View
        collapsable={false}
        style={[
          styles.control,
          multiline && { minHeight: 104, alignItems: "flex-start", paddingTop: 12 },
          {
            backgroundColor: p.dark ? "rgba(255,255,255,0.04)" : colors.white,
            borderColor: error ? errorColor : focused ? p.brand : p.input,
          },
        ]}
      >
        {icon}
        <TextInput
          placeholderTextColor={p.dark ? "#6b7079" : colors.slate500}
          selectionColor={p.brand}
          style={[styles.input, { color: p.text }, multiline && { textAlignVertical: "top", minHeight: 80 }]}
          multiline={multiline}
          accessibilityLabel={label}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...input}
        />
      </View>
      {error ? (
        <Text style={{ color: errorColor, fontSize: 13, fontFamily: fonts.body }}>{error}</Text>
      ) : (
        hint && <Txt variant="muted">{hint}</Txt>
      )}
    </View>
  );
}

export function FormMessage({ message, ok }: { message: string | null | undefined; ok?: boolean }) {
  const p = usePalette();
  if (!message) return null;
  const t = toneColors[ok ? "success" : "danger"];
  return (
    <View style={[styles.formMessage, { backgroundColor: p.dark ? t.bgDark : t.bg }]} accessibilityLiveRegion="polite">
      <Text style={{ color: p.dark ? t.fgDark : t.fg, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 }}>{message}</Text>
    </View>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const p = usePalette();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -space.gutter, marginBottom: space.toolbar }}
      contentContainerStyle={{ gap: 6, paddingHorizontal: space.gutter }}
    >
      {options.map((o) => {
        const active = o.value === value;
        const fg = active ? p.brand : p.textMuted;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, { backgroundColor: active ? p.brandTint : p.surface, borderColor: active ? "rgba(114,62,230,0.35)" : p.border }]}
          >
            <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: fg }}>{o.label}</Text>
            {o.count !== undefined && (
              <View style={[styles.chipCount, { backgroundColor: active ? p.brand : p.surfaceMuted }]}>
                <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: active ? p.inkForeground : p.textMuted }}>{o.count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// --------------------------------------------------------------------------- states

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={[styles.empty, { borderColor: p.input, backgroundColor: p.surface }]}>
      <View style={[styles.emptyIcon, { backgroundColor: p.surfaceMuted }]}>
        {isValidElement(icon) ? cloneElement(icon as ReactElement<{ size?: number; color?: string }>, { size: 20, color: p.textMuted }) : icon}
      </View>
      <Txt variant="h3" style={{ textAlign: "center" }}>
        {title}
      </Txt>
      {body && (
        <Txt variant="muted" style={{ textAlign: "center", maxWidth: 300 }}>
          {body}
        </Txt>
      )}
      {action}
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const p = usePalette();
  const message = error instanceof Error ? error.message : "This screen could not be loaded.";
  return (
    <Empty
      icon={<CircleAlert size={20} color={colors.red500} />}
      title="Something went wrong"
      body={message}
      action={onRetry && <Button title="Try again" icon={<RefreshCw size={16} color={p.inkForeground} />} onPress={onRetry} small style={{ marginTop: 8 }} />}
    />
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12, backgroundColor: p.page }} accessibilityLabel={label}>
      <ActivityIndicator color={p.primary} size="large" />
      <Txt variant="muted">{label}</Txt>
    </View>
  );
}

// --------------------------------------------------------------------------- CCTV placeholder

export function CctvPreview({ label, offline, detection, height = 180 }: { label: string; offline?: boolean; detection?: string; height?: number }) {
  return (
    <View style={[styles.cctv, { height }]} accessibilityLabel={`CCTV feed ${label}${offline ? ", offline" : ""}`} accessibilityRole="image">
      <View style={[StyleSheet.absoluteFill, { opacity: offline ? 0.4 : 1 }]}>
        <View style={styles.sky} />
        <View style={[styles.building, { left: "3%", width: "22%", height: "26%" }]} />
        <View style={[styles.building, { right: "4%", width: "18%", height: "18%" }]} />
        <View style={styles.road} />
        <View style={[styles.lane, { bottom: "4%", height: "16%" }]} />
        <View style={[styles.lane, { bottom: "28%", height: "12%" }]} />
        <View style={[styles.car, { left: "20%", bottom: "10%", width: "18%", height: "20%", backgroundColor: "#e8ecf1" }]} />
        {!offline && <View style={[styles.car, { left: "55%", bottom: "36%", width: "10%", height: "11%", backgroundColor: "#c8453f" }]} />}
      </View>
      {detection && !offline && (
        <View style={styles.detectBox}>
          <Text style={styles.detectLabel}>{detection}</Text>
        </View>
      )}
      <View style={styles.cctvOverlay}>
        <View style={styles.rec}>
          {!offline && <View style={[styles.liveDot, { backgroundColor: "#ff4d5a" }]} />}
          <Text style={styles.mono}>{offline ? "NO SIGNAL" : "LIVE"}</Text>
        </View>
        <View style={styles.rec}>
          <Text style={styles.mono}>{label}</Text>
        </View>
      </View>
      {offline && (
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          <Text style={[styles.mono, { fontSize: 12, letterSpacing: 2.4 }]}>CAMERA OFFLINE</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: space.gutter, paddingTop: space.block, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: space.block },
  sectionTitle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.section - 8, marginBottom: space.related },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.card },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, height: 24 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  callout: { flexDirection: "row", gap: 10, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12 },
  statTile: { width: 32, height: 32, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  kv: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  button: { minHeight: 48, borderRadius: radius.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 18 },
  buttonSmall: { minHeight: 36, paddingHorizontal: 12 },
  iconButton: { width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  iconBadge: { position: "absolute", top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.red500, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  control: { minHeight: 48, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, minHeight: 46 },
  formMessage: { borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12, height: 36 },
  chipCount: { minWidth: 20, height: 20, borderRadius: 4, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 40, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed" },
  emptyIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  cctv: { borderRadius: radius.md, overflow: "hidden", backgroundColor: "#2a313c" },
  sky: { position: "absolute", left: 0, right: 0, top: 0, height: "41%", backgroundColor: "#202a3a" },
  building: { position: "absolute", bottom: "59%", backgroundColor: "#172031" },
  road: { position: "absolute", left: "-10%", right: "-10%", bottom: 0, height: "59%", backgroundColor: "#3b4350", borderTopLeftRadius: 400, borderTopRightRadius: 400 },
  lane: { position: "absolute", left: "49%", width: 5, backgroundColor: "#d9d2a6", opacity: 0.7, borderRadius: 1 },
  car: { position: "absolute", borderRadius: 5 },
  detectBox: { position: "absolute", left: "17%", bottom: "6%", width: "24%", height: "30%", borderWidth: 2, borderColor: "#ff4d5a", borderRadius: 6 },
  detectLabel: { position: "absolute", top: -22, left: -2, backgroundColor: "#ff4d5a", color: "white", fontSize: 10, fontFamily: fonts.semibold, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, overflow: "hidden" },
  cctvOverlay: { position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", justifyContent: "space-between" },
  rec: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  mono: { color: "rgba(255,255,255,0.92)", fontSize: 10, fontFamily: fonts.mono },
});

// --------------------------------------------------------------------------- brand

/** The parking-sign "P" tile used as the Park Mandu mark. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: colors.violet, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.white, fontFamily: fonts.display, fontSize: size * 0.5, lineHeight: size * 0.62 }}>P</Text>
    </View>
  );
}

export function Brand({ subtitle }: { subtitle?: string }) {
  const p = usePalette();
  return (
    <Row gap={10}>
      <BrandMark />
      <View>
        <Text style={{ fontFamily: fonts.display, fontSize: 17, color: p.heading, letterSpacing: -0.3 }}>Park Mandu</Text>
        {subtitle && <Txt variant="small">{subtitle}</Txt>}
      </View>
    </Row>
  );
}
