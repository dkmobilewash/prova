// The field app's palette — light and high-contrast on purpose.
//
// The web app (source of truth: apps/web/tailwind.config.ts) runs the dark
// "MainVision / Money Rail" set. That is the wrong default here: the field
// app is opened outside, in direct sun, on a dirty wet screen, by a gloved
// hand that wants out in fifteen seconds. Dark grounds mirror in sunlight;
// a light canvas with near-black ink stays legible through glare. So this
// mirrors the web's SEMANTIC TOKEN NAMES but not its dark values — same
// vocabulary, outdoor-tuned values.
//
// Rules that follow from that:
//  - Body text ≥15px, ink at ≥10:1 on canvas (ink itself is ~20:1).
//  - Every tappable target ≥44pt (see `hitTarget`).
//  - `brand` is the founder yellow (#facc15) and is a FILL only: it always
//    carries a dark `brandInk` label. Yellow as text is unreadable on white,
//    which is why links use the darkened amber `link` instead.

export const colors = {
  canvas: "#ffffff", // page background — pure white, the glare-hardy default
  surface: "#ffffff", // card background — white on white, hairline divides
  rail: "#f5f5f5", // chrome / top bar ground
  railHover: "#ebebeb",

  lineCard: "#d4d4d4", // hairline card outlines — soft grey, never black
  lineRow: "#e5e5e5", // row dividers inside cards

  ink: "#0a0a0a", // primary text — near-black, ~20:1 on canvas
  inkLabel: "#171717", // labels, section headers
  inkBody: "#404040", // secondary text — ~10:1
  inkMuted: "#737373", // placeholders/disabled — optional text only, ~4.9:1

  brand: "#facc15", // yellow fill (buttons, chips) — never text on light
  brandInk: "#1a1a1a", // dark label on a brand fill — ~9.5:1

  link: "#a16207", // darkened amber, readable as text on white
  linkHover: "#854d0e",

  barRose: "#e11d48",
  barAmber: "#d97706",
  barGreen: "#16a34a",
  barBlue: "#2563eb",
  barIndigo: "#4f46e5",
  barViolet: "#7c3aed",
  barTeal: "#0d9488",

  // Tag pairs: LIGHT grounds under DARK inks — the inverse of the web's
  // dark grounds, so the meanings (error/warning/success) survive but stay
  // readable on white. tagBlue keeps the brand-yellow fill with dark ink,
  // exactly as the web does.
  tagRose: "#fee2e2",
  tagRoseInk: "#b91c1c",
  tagAmber: "#fef3c7",
  tagAmberInk: "#92400e",
  tagGreen: "#dcfce7",
  tagGreenInk: "#166534",
  tagBlue: "#facc15",
  tagBlueInk: "#422006",
  tagSlate: "#e5e7eb",
  tagSlateInk: "#374151",
} as const;

/** Big, heavy type. Body defaults to 17; nothing below 13, and 13 is only
 * for secondary metadata. Labels run semibold (600) — the gloved thumb is
 * reading while moving, not while sitting still. */
export const typography = {
  size: {
    xs: 13,
    sm: 15,
    md: 17,
    lg: 20,
    xl: 24,
    xxl: 32,
  },
  weight: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
  leading: {
    tight: 1.2,
    normal: 1.35,
    loose: 1.5,
  },
} as const;

/** Minimum touch target in points. Apple's own floor is 44pt; the field app
 * keeps it as a floor, not an aim — a foreman's glove is bigger than a
 * fingertip. Primary actions run taller than this (see Button). */
export const hitTarget = 44;
