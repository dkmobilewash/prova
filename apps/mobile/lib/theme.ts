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

  /**
   * OUTDOOR — direct sun, and chosen by hand rather than sensed.
   *
   * A phone in a gloved hand on a roof at 2pm is not the same surface as
   * the same phone in a trailer, and auto-switching gets it wrong in both
   * directions: an ambient-light sensor cannot tell bright sun from a
   * bright office, and a theme that flips while somebody is mid-entry is
   * worse than one they picked. So this is a Settings choice
   * (system / light / dark / outdoor), per Diego 2026-09-26.
   *
   * Every ink here clears 7:1 and most clear 12:1 — `inkMuted` stops
   * being muted, which is the point rather than an oversight: in sun
   * there is no such thing as secondary text, only text you can read and
   * text you cannot. Borders go to 3:1 (the non-text floor) so a card
   * edge survives glare. The brand fill is unchanged, because yellow at
   * full chroma is the one thing sunlight does not wash out.
   */
  outdoor: {
    colors: {
      canvas: "#ffffff",
      surface: "#ffffff",
      rail: "#f2f2f2",
      railHover: "#e0e0e0",

      lineCard: "#6b6b6b", // 4.8:1 on white — a border that survives glare
      lineRow: "#8a8a8a", // 3.1:1, the non-text floor

      ink: "#000000", // 21:1
      inkLabel: "#141414", // 18.9:1
      inkBody: "#262626", // 14.4:1
      inkMuted: "#3d3d3d", // 9.7:1 — see the note above

      brand: "#facc15",
      brandInk: "#171717",

      link: "#7a3d00", // 8.1:1 on white
      linkHover: "#5c2e00",

      // Status bars darkened to clear 3:1 as fills on white.
      barRose: "#c01a10",
      barAmber: "#8a5200",
      barGreen: "#0a6b3d",
      barBlue: "#1d4ed8",
      barIndigo: "#4338ca",
      barViolet: "#6d28d9",
      barTeal: "#0f766e",

      // Tag pairs: pale grounds, near-black inks. Every ink clears 7:1 on
      // its own ground.
      tagRose: "#ffe0e0",
      tagRoseInk: "#8a0000",
      tagAmber: "#fff0cc",
      tagAmberInk: "#6b3f00",
      tagGreen: "#d9f5e3",
      tagGreenInk: "#0a5c2e",
      tagBlue: "#facc15",
      tagBlueInk: "#2b1500",
      tagSlate: "#e8e8e8",
      tagSlateInk: "#262626",

      tagBrandSoft: "#fff4b8",
      tagBrandSoftInk: "#5c3600",
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
  two: 2,
  xxs: 4,
  six: 6,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,

  /**
   * THE FOUR BELOW ARE OFF THE 4-PT GRID ON PURPOSE, and naming them is
   * the point: each was already in the code as a bare number in several
   * files, which is exactly the "spacing nobody can name" the grid rule
   * exists to stop. Snapping them to the grid instead would redraw every
   * field, chip and badge in the app — a visual change wearing a token
   * change's clothes, which is not what a token PR is for.
   */

  /** Vertical inset inside a CONTROL — a field, a grouped row, a tile.
   * 10 is what puts 17pt text in the middle of a 48pt row without the
   * row growing when the text does. */
  control: 10,
  /** Horizontal inset inside a control. Apple's own text fields sit at
   * 14, which is why a chip beside one at 16 reads as misaligned. */
  controlX: 14,
  /** The vertical inset of a status badge or count pill — small because
   * the pill is sized by its 13pt text, not by a thumb. */
  badge: 3,
  /** The bottom inset on a scrolling tab screen: clears the tab bar and
   * the floating capture button so the last row is reachable rather than
   * parked under them. */
  scrollBottom: 88,
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

/**
 * Minimum touch target in points.
 *
 * 48, not Apple's 44, and the difference is deliberate rather than a
 * rounding: **our users are in gloves**, and Android's own floor is 48dp.
 * 44 is the smallest target a bare fingertip can hit reliably on a phone
 * held still — which is not the posture this app is used in. Raised from
 * 44 by Diego on 2026-09-26.
 *
 * `touch-targets.test.ts` fails the build on a pressable component that
 * declares less, with a named debt list for the two that have not been
 * migrated yet.
 */
export const hitTarget = 48;

/**
 * Primary actions — the one button a screen exists for: Save, Clock in,
 * Sign and finish. Taller than the floor because it is found by thumb
 * while walking, and because a 56pt target is still comfortably inside
 * the bottom third of every phone this app runs on.
 */
export const hitTargetPrimary = 56;

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

/**
 * What a STATE looks like, named by the thing it is a state of.
 *
 * `StatusBadge` used to hold its own private map of job and integration
 * states; invoice and change-order states had no tokens at all, so the
 * next screen that needed "Overdue" would have invented one. Naming them
 * here is what stops three screens disagreeing about whether an overdue
 * invoice is rose or amber.
 *
 * Each entry is a TAG PAIR — a ground and the ink that must sit on it —
 * because that is the only way the meaning survives a palette change:
 * `theme-contrast.test.ts` holds every pair to its floor in all three
 * palettes, so a state cannot be readable in dark and illegible in sun.
 *
 * The mapping is a judgement and worth arguing with:
 *   slate  = nothing is owed by anyone yet (draft, estimate)
 *   blue   = live and agreed (the brand fill, the web's "In progress")
 *   amber  = waiting on somebody, and time is passing (sent, submitted)
 *   green  = settled (paid, approved, complete, signed)
 *   rose   = wrong, and somebody has to act (overdue, rejected, error)
 */
export type StatusPair = { bg: ColorKey; ink: ColorKey };

export const statusTokens = {
  job: {
    ESTIMATE: { bg: "tagSlate", ink: "tagSlateInk" },
    CONTRACTED: { bg: "tagBlue", ink: "tagBlueInk" },
    IN_PROGRESS: { bg: "tagAmber", ink: "tagAmberInk" },
    COMPLETE: { bg: "tagGreen", ink: "tagGreenInk" },
  },
  invoice: {
    DRAFT: { bg: "tagSlate", ink: "tagSlateInk" },
    SENT: { bg: "tagAmber", ink: "tagAmberInk" },
    PARTIAL: { bg: "tagBrandSoft", ink: "tagBrandSoftInk" },
    PAID: { bg: "tagGreen", ink: "tagGreenInk" },
    /** The one state on this phone that is about money going wrong. */
    OVERDUE: { bg: "tagRose", ink: "tagRoseInk" },
  },
  changeOrder: {
    DRAFT: { bg: "tagSlate", ink: "tagSlateInk" },
    SUBMITTED: { bg: "tagAmber", ink: "tagAmberInk" },
    APPROVED: { bg: "tagGreen", ink: "tagGreenInk" },
    REJECTED: { bg: "tagRose", ink: "tagRoseInk" },
  },
  /** Not a domain object, but it wears the same chip. */
  integration: {
    CONNECTED: { bg: "tagGreen", ink: "tagGreenInk" },
    NOT_CONNECTED: { bg: "tagSlate", ink: "tagSlateInk" },
    NEEDS_REAUTH: { bg: "tagAmber", ink: "tagAmberInk" },
    ERROR: { bg: "tagRose", ink: "tagRoseInk" },
    SIGNED: { bg: "tagGreen", ink: "tagGreenInk" },
  },
} as const satisfies Record<string, Record<string, StatusPair>>;

export type StatusDomain = keyof typeof statusTokens;

/** The pair for a state, or the neutral one — an unknown status is shown
 * as "nothing is owed by anyone yet" rather than crashing or, worse,
 * borrowing a colour that means something. */
export function statusPair(domain: StatusDomain, status: string): StatusPair {
  const pairs = statusTokens[domain] as Record<string, StatusPair | undefined>;
  return pairs[status] ?? { bg: "tagSlate", ink: "tagSlateInk" };
}
