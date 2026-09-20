/**
 * Every icon the app draws, named for what it MEANS rather than what it
 * looks like — and kept as plain data, away from the component, so a test
 * can read it without loading React Native.
 *
 * The emoji this replaced were never icons: they render in Apple's own
 * colours, so they ignored the palette entirely and glowed against a dark
 * canvas; they sit at whatever weight the system font gives them; and 🏗️
 * beside ⏱️ beside 📦 reads as a keyboard, not a product.
 *
 * One map, for the same reason colours live in one file: a screen that
 * names a glyph directly is a screen that can disagree with another one
 * about what "photos" looks like.
 *
 * Each entry is [outline, filled]. Ionicons is the set iOS's own idiom was
 * drawn from, and the pairing is the platform convention: OUTLINE when a
 * tab is idle, FILLED when it is selected.
 */
export const ICON_GLYPHS = {
  // Tabs
  home: ["home-outline", "home"],
  jobs: ["business-outline", "business"],
  create: ["add-circle-outline", "add-circle"],
  camera: ["camera-outline", "camera"],
  settings: ["settings-outline", "settings"],

  // The sections of a job
  report: ["document-text-outline", "document-text"],
  photos: ["images-outline", "images"],
  safety: ["shield-checkmark-outline", "shield-checkmark"],
  time: ["time-outline", "time"],
  materials: ["cube-outline", "cube"],
  punch: ["checkbox-outline", "checkbox"],
  ticket: ["receipt-outline", "receipt"],

  /** The tick inside a checkbox. Both halves are the same glyph: it is
   * already inside a filled box, so a second weight would say nothing. */
  check: ["checkmark", "checkmark"],
} as const;

export type IconName = keyof typeof ICON_GLYPHS;
