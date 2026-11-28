// Editorial Paper & Ink Design System (iOS HIG aligned, zero AI slop)

import { Platform } from "react-native";

export type ThemeMode = "light" | "dark";

export interface Palette {
  mode: ThemeMode;
  bg: string;
  bgSubtle: string;
  bgElevated: string;
  bgSurface: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  onAccent: string;
}

export const LIGHT_PALETTE: Palette = {
  mode: "light",
  bg: "#F8F5EF",
  bgSubtle: "#F1ECE3",
  bgElevated: "#FFFDF9",
  bgSurface: "#FFFFFF",
  border: "#E5DED1",
  borderStrong: "#D2C7B4",
  text: "#1B1917",
  textMuted: "#5C574F",
  textDim: "#8A8378",
  accent: "#B34D22",
  accentSoft: "rgba(179, 77, 34, 0.10)",
  success: "#2F6F4E",
  successSoft: "rgba(47, 111, 78, 0.11)",
  warn: "#9A631A",
  warnSoft: "rgba(154, 99, 26, 0.12)",
  danger: "#B4342B",
  dangerSoft: "rgba(180, 52, 43, 0.10)",
  onAccent: "#FFFDF9",
};

export const DARK_PALETTE: Palette = {
  mode: "dark",
  bg: "#141311",
  bgSubtle: "#1A1816",
  bgElevated: "#201E1B",
  bgSurface: "#1C1A17",
  border: "#2C2824",
  borderStrong: "#3E3933",
  text: "#EDE8DF",
  textMuted: "#A49D92",
  textDim: "#756F65",
  accent: "#DC7B4A",
  accentSoft: "rgba(220, 123, 74, 0.15)",
  success: "#6BBF92",
  successSoft: "rgba(107, 191, 146, 0.14)",
  warn: "#E2AE55",
  warnSoft: "rgba(226, 174, 85, 0.15)",
  danger: "#E27168",
  dangerSoft: "rgba(226, 113, 104, 0.14)",
  onAccent: "#141311",
};

export const FONTS = {
  serif: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }),
  sans: Platform.select({ ios: "System", android: "sans-serif", default: "System" }),
  mono: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
};

export function getPalette(mode: ThemeMode): Palette {
  return mode === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
}
