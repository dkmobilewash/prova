// The field app's design tokens.
//
// TWO palettes now, and the dark one is still the web's: source of truth
// for `dark` is apps/web/tailwind.config.ts, the approved "MainVision /
// Money Rail" set, copied exactly with matching token names.
//
// The LIGHT palette is the mobile app's own set, derived from Apple's HIG
// system colours (systemGroupedBackground, label/secondaryLabel,
// systemFill rows) so the phone reads as a native iOS app in light mode.
// It is NOT copied from the web — the web is dark-only, and there is no
// light web theme to copy. Do not "fix" the asymmetry by making the two
// sides match; they are different products on different surfaces.
//
// The 2026-09-20 flip to dark is recorded here because the reasoning it
// lost was about product identity, not colour: a GC who sees a white
// phone app and a dark web app is looking at two different products. The
// system-appearance switch below keeps that identity (dark by default on
// the web) while giving the phone the native light mode the brief asked
// for. If the field complains about glare, dark is one Settings toggle
// away — that was the point of keeping the vocabulary identical.
//
// What did NOT change, because none of it was about colour: body text
// stays 17px, nothing below 13, every tappable target stays at least 44pt.
// Those are the parts of the field design that earn their keep in gloves.
//
// Rules that survive every palette:
//  - `brand` (#facc15) is a FILL and always carries the dark `brandInk`
//    label. Yellow text on a yellow fill is the one mistake this palette
//    makes easy. At most one brand fill per screen.
//  - As TEXT, `link` is the readable amber — never `brand`.
//  - Contrast is not a matter of opinion here: theme-contrast.test.ts
//    fails the build if any pair below drops under its floor, and
//    theme-parity.test.ts fails it if the palettes drift apart.

export const palettes = {
  light: {
    colors: {
      canvas: "#f2f2f7", // page background — HIG systemGroupedBackground
      surface: "#ffffff", // grouped-list surface
      rail: "#f9f9f9", // chrome: headers and the tab bar, lifted off the canvas
      railHover: "#e9e9ec", // pressed-row fill (HIG cell highlight)

      lineCard: "#e2e2e7", // 1px soft grey outlines — never white, never black
      lineRow: "#ececef", // row dividers inside groups

      ink: "#1c1c1e", // primary text
      inkLabel: "#3c3c43", // labels, section headers
      inkBody: "#48484a", // secondary text
      inkMuted: "#6f6f6f", // placeholders/disabled — optional text only

      brand: "#facc15", // yellow fill (buttons, chips) — never as text on it
      brandInk: "#171717", // dark label on a brand fill

      link: "#92400e", // amber, readable as text on light grounds
      linkHover: "#78350f",

      barRose: "#f04438",
      barAmber: "#f79009",
      barGreen: "#12b76a",
      barBlue: "#3b82f6",
      barIndigo: "#6366f1",
      barViolet: "#8b5cf6",
      barTeal: "#14b8a6",

      // Tag pairs: light grounds under dark inks, so error/warning/success
      // keep their meanings on a light canvas. `tagBlue` is the one pair
      // that keeps the brand fill — the "In progress" chip, both modes.
      tagRose: "#fee2e2",
      tagRoseInk: "#b91c1c",
      tagAmber: "#fef3c7",
      tagAmberInk: "#92400e",
      tagGreen: "#dcfce7",
      tagGreenInk: "#166534",
      tagBlue: "#facc15",
      tagBlueInk: "#422006",
      tagSlate: "#e4e4e7",
      tagSlateInk: "#3f3f46",

      /** Soft brand chip: light gold ground, dark amber ink. */
      tagBrandSoft: "#fef9c3",
      tagBrandSoftInk: "#854d0e",
    },
  },
  dark: {
    colors: {
      canvas: "#0f0f0f", // page background
      surface: "#1a1a1a", // card background
      rail: "#171717", // chrome: headers and the tab bar, lifted off the canvas
      railHover: "#262626",

      lineCard: "#3d3d3d", // 1px soft grey card outlines — never white, never black
      lineRow: "#2e2e2e", // row dividers inside cards

      ink: "#fafafa", // primary text
      inkLabel: "#e5e5e5", // labels, section headers
      inkBody: "#d4d4d4", // secondary text
      inkMuted: "#a3a3a3", // placeholders/disabled — optional text only

      brand: "#facc15", // yellow fill (buttons, chips) — never as text on it
      brandInk: "#171717", // dark label on a brand fill

      link: "#eab308", // gold, readable as text on these grounds
      linkHover: "#facc15",

      barRose: "#f04438",
      barAmber: "#f79009",
      barGreen: "#12b76a",
      barBlue: "#3b82f6",
      barIndigo: "#6366f1",
      barViolet: "#8b5cf6",
      barTeal: "#14b8a6",

      // Tag pairs: dark grounds under light inks, so error/warning/success
      // keep their meanings on a dark canvas.
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

      /** Soft brand chip: dark gold ground, brand-yellow ink. */
      tagBrandSoft: "#2e2508",
      tagBrandSoftInk: "#facc15",
    },
  },
} as const;

/** Every colour token name — the vocabulary both palettes must share. */
export type ColorKey = keyof (typeof palettes)["light"]["colors"];

/** The palette shape components consume: every colour key, values as
 * strings. The hex LITERALS are widened on purpose — light and dark hold
 * different values over one vocabulary, and a type that pins the light
 * values would reject the dark palette outright. */
export type Palette = { colors: Record<ColorKey, string> };

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
    /** The large title — screens' top block on headerless tabs. */
    xl2: 34,
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

/** Spacing scale. The 4-pt grid iOS layouts sit on; `md` (16) is the
 * screen gutter. `one` and `six` are the two deliberate half-steps — the
 * tightest meta-line rhythm and the label-to-field gap — tokenised
 * because a gap nobody can name is how two screens drift 1pt apart
 * forever. */
export const space = {
  one: 1,
  xxs: 4,
  six: 6,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

/** Corner radii, by the shape they belong to rather than a number. */
export const radius = {
  field: 10,
  card: 12,
  sheet: 20,
  pill: 999,
  checkbox: 8,
  /** Small media corners — the photo preview, the signature paper. */
  small: 8,
  /** The calendar's circular day cell: half its own height. */
  dayCell: 19,
} as const;

/** Elevation is used exactly once in this app — under the floating
 * capture button, where a 56pt circle over scrolling content is the one
 * surface that earns a shadow. Everything else stays flat: borders and
 * surface tones do the lifting, per the brief ("the interface should
 * feel almost flat until depth is needed"). */
export const shadow = {
  floating: {
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} as const;

/** Minimum touch target in points. Apple's own floor is 44pt; the field app
 * keeps it as a floor, not an aim — a foreman's glove is bigger than a
 * fingertip. Primary actions run taller than this (see Button). */
export const hitTarget = 44;

/**
 * A line height in POINTS, which is the only thing React Native's
 * `lineHeight` accepts.
 *
 * `typography.leading` is a RATIO. Handing one straight to `lineHeight`
 * type-checks, lints clean, and renders a 1.35-POINT line — the text is
 * clipped to the top pixel or two of its glyphs, so the screen reads as
 * blank space rather than as a defect. Every empty-state description on
 * the phone shipped that way and no test could see it: happy-dom does no
 * layout, so a clipped line and a drawn one are the same DOM. It was
 * found by looking at a real phone (#427's click-list), on five screens.
 *
 * `design-tokens.test.ts` now fails the build if a ratio reaches a
 * `lineHeight`. This is what to use instead.
 */
export function leadingFor(
  size: number,
  ratio: number = typography.leading.normal,
): number {
  return Math.round(size * ratio);
}
