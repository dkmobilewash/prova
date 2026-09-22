// The field app's palette — the SAME dark theme as the web app.
//
// Source of truth: apps/web/tailwind.config.ts, the approved
// "MainVision / Money Rail" set. The values here are copied from it
// exactly, and the token NAMES already matched, which is what made this a
// one-file change rather than a re-skin of every screen.
//
// THIS FILE USED TO BE LIGHT, ON PURPOSE, and the reasoning is worth
// keeping rather than quietly deleting: the field app is opened outdoors,
// in direct sun, on a wet dirty screen, and dark grounds mirror in
// sunlight while near-black on white stays legible through glare. That
// argument lost to a bigger one on 2026-09-20 — Diego's call. A GC who
// sees a white phone app and a dark web app is looking at two different
// products, and product identity beats a glare theory nobody has tested on
// a roof. If the field does complain, a light "sunlight" mode is cheap
// from here: the vocabulary below is shared with the web, so it is another
// set of values, not another design.
//
// What did NOT change, because none of it was about colour: body text
// stays 17px, nothing below 13, every tappable target stays at least 44pt.
// Those are the parts of the field design that earn their keep in gloves.
//
// Rules that survive the flip:
//  - `brand` (#facc15) is a FILL and always carries the dark `brandInk`
//    label. Yellow text on a yellow fill is the one mistake this palette
//    makes easy.
//  - As TEXT, the gold `link` is fine on these dark grounds (10:1 on
//    canvas) — which is why the light theme's darkened amber is gone.
//  - Contrast is not a matter of opinion here: theme-contrast.test.ts
//    fails the build if any pair below drops under its floor.

export const colors = {
  canvas: "#0f0f0f", // page background
  surface: "#1a1a1a", // card background
  rail: "#171717", // chrome: headers and the tab bar, lifted off the canvas
  railHover: "#262626",

  lineCard: "#3d3d3d", // 1px soft grey card outlines — never white, never black
  lineRow: "#2e2e2e", // row dividers inside cards

  ink: "#fafafa", // primary text — 18.4:1 on canvas
  inkLabel: "#e5e5e5", // labels, section headers — 15.2:1
  inkBody: "#d4d4d4", // secondary text — 12.9:1
  inkMuted: "#a3a3a3", // placeholders/disabled — optional text only, 7.6:1

  brand: "#facc15", // yellow fill (buttons, chips) — never as text on it
  brandInk: "#171717", // dark label on a brand fill — 9.5:1

  link: "#eab308", // gold, readable as text on these grounds — 10:1
  linkHover: "#facc15",

  barRose: "#f04438",
  barAmber: "#f79009",
  barGreen: "#12b76a",
  barBlue: "#3b82f6",
  barIndigo: "#6366f1",
  barViolet: "#8b5cf6",
  barTeal: "#14b8a6",

  // Tag pairs: dark grounds under light inks, so error/warning/success
  // keep their meanings on a dark canvas. `tagBlue` is the one pair that
  // keeps a light ground — the brand fill with dark ink, exactly as the
  // web does for an "In progress" chip.
  tagRose: "#3a1518",
  tagRoseInk: "#f97066",
  tagAmber: "#3a2a08",
  tagAmberInk: "#f0c464",
  tagGreen: "#143a26",
  tagGreenInk: "#7ee2a8",
  tagBlue: "#facc15",
  tagBlueInk: "#422006",
  tagSlate: "#23282f",
  tagSlateInk: "#9fb6c9",

  /** Soft brand chip: dark gold ground, brand-yellow ink — 9.9:1. */
  tagBrandSoft: "#2e2508",
  tagBrandSoftInk: "#facc15",
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
