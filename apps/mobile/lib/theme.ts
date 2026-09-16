// The web app's semantic colour tokens, mirrored for React Native.
// Source of truth is apps/web/tailwind.config.ts — keep these in sync so a
// mobile screen reads as the same app, not a different one.

export const colors = {
  canvas: "#020617", // slate-950 — page background
  surface: "#0f172a", // slate-900 — card background
  rail: "#0f172a",
  railHover: "#1e293b",

  lineCard: "#1e293b", // slate-800 — hairline borders
  lineRow: "#1e293b",

  ink: "#f1f5f9", // slate-100 — primary text
  inkLabel: "#cbd5e1", // slate-300 — labels
  inkBody: "#94a3b8", // slate-400 — body text
  inkMuted: "#64748b", // slate-500 — placeholders/disabled

  brand: "#2563eb", // blue-600

  barRose: "#f04438",
  barAmber: "#f79009",
  barGreen: "#12b76a",
  barBlue: "#3b82f6",
  barIndigo: "#6366f1",
  barViolet: "#8b5cf6",
  barTeal: "#14b8a6",

  tagRose: "#371f2f",
  tagRoseInk: "#fca5a5",
  tagAmber: "#382f24",
  tagAmberInk: "#fcd34d",
  tagGreen: "#123633",
  tagGreenInk: "#86efac",
  tagBlue: "#172a4f",
  tagBlueInk: "#93c5fd",
  tagSlate: "#151f32",
  tagSlateInk: "#cbd5e1",
} as const;
