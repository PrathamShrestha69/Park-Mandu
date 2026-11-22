import { createContext, useContext } from "react";

/**
 * Park Mandu design tokens — hex equivalents of the web app's OKLCH tokens
 * (frontend/web/src/app/globals.css). Professional light dashboard: cool grey canvas,
 * white bordered panels, one violet accent, blue reserved for information. No gradients.
 *
 * The historic names (navy, blue, slate…) are kept so screens keep compiling.
 */
export const colors = {
  // Violet accent: primary actions, active navigation, selection
  violet: "#723ee6",
  violetInk: "#5c26c3",
  violetTint: "#f1efff",
  // Dark neutrals (was navy)
  navy950: "#16181f",
  navy900: "#16181f",
  navy850: "#2b2e36",
  navy800: "#2b2e36",
  // Blue: information, government parking
  blue700: "#0859ac",
  blue600: "#0a7bda",
  blue500: "#0a7bda",
  blue100: "#e1f0ff",
  blue50: "#f0f7ff",
  // Status
  green700: "#006436",
  green500: "#0fa05c",
  green100: "#dcf1e4",
  green50: "#eef8f2",
  amber700: "#8d4f0c",
  amber500: "#f2ab35",
  amber100: "#fdf0d8",
  red700: "#b91f25",
  red500: "#d0252a",
  red100: "#fbe3e2",
  red50: "#fdf3f2",
  cyan500: "#0a7bda",
  // Cool neutrals (was slate)
  slate950: "#16181f",
  slate800: "#2b2e36",
  slate700: "#444750",
  slate600: "#656972",
  slate500: "#7d8088",
  slate400: "#a2a4ab",
  slate300: "#d8dbe0",
  slate200: "#e4e6ea",
  slate100: "#f2f3f7",
  slate50: "#f6f7fa",
  white: "#ffffff",
} as const;

export interface Palette {
  dark: boolean;
  page: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  input: string;
  text: string;
  textMuted: string;
  heading: string;
  /** Spinner / refresh tint. */
  primary: string;
  /** Solid primary button fill. */
  ink: string;
  inkForeground: string;
  brand: string;
  brandInk: string;
  brandTint: string;
  tabBar: string;
}

export const lightPalette: Palette = {
  dark: false,
  page: colors.slate50,
  surface: colors.white,
  surfaceMuted: colors.slate100,
  border: colors.slate200,
  input: colors.slate300,
  text: colors.slate950,
  textMuted: colors.slate600,
  heading: colors.slate950,
  primary: colors.violet,
  ink: colors.violet,
  inkForeground: colors.white,
  brand: colors.violet,
  brandInk: colors.violetInk,
  brandTint: colors.violetTint,
  tabBar: colors.white,
};

/** Traffic police share the same light, professional theme. */
export const policePalette: Palette = lightPalette;

export const PaletteContext = createContext<Palette>(lightPalette);
export const usePalette = () => useContext(PaletteContext);

export const fonts = {
  body: "FunnelSans_400Regular",
  medium: "FunnelSans_500Medium",
  semibold: "FunnelSans_600SemiBold",
  bold: "FunnelSans_600SemiBold",
  display: "FunnelDisplay_600SemiBold",
  displayBold: "FunnelDisplay_600SemiBold",
  mono: "IBMPlexMono_500Medium",
} as const;

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export const toneColors: Record<Tone, { fg: string; bg: string; border: string; fgDark: string; bgDark: string }> = {
  success: { fg: colors.green700, bg: colors.green50, border: "#bfe5cd", fgDark: "#84dfa5", bgDark: "rgba(41,172,104,0.16)" },
  warning: { fg: colors.amber700, bg: colors.amber100, border: "#f6d79d", fgDark: "#fac871", bgDark: "rgba(242,171,53,0.16)" },
  danger: { fg: colors.red700, bg: colors.red50, border: "#f4c4c2", fgDark: "#ff8f8f", bgDark: "rgba(244,89,91,0.16)" },
  info: { fg: colors.blue700, bg: colors.blue50, border: "#bcdcfb", fgDark: "#91c0ff", bgDark: "rgba(82,148,246,0.16)" },
  neutral: { fg: colors.slate700, bg: colors.slate100, border: colors.slate200, fgDark: "#c8ccd3", bgDark: "rgba(255,255,255,0.07)" },
};

/** Same radii as the web app (8 / 10 / 12 px). */
export const radius = { sm: 8, md: 10, lg: 12 } as const;

/** Spacing scale shared by every screen: related 12, toolbar→content 16, blocks 24, sections 40. */
export const space = { related: 12, toolbar: 16, block: 24, section: 40, card: 20, row: 16, gutter: 16 } as const;

/** Surfaces use hairline borders, not drop shadows; kept for floating elements only. */
export const shadow = {
  shadowColor: "#000",
  shadowOpacity: 0.08,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
} as const;
