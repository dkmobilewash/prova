import type { Config } from "tailwindcss";

/**
 * Semantic colour tokens for the light theme.
 *
 * Named for their job rather than their value, because the previous pass
 * scattered raw utilities (`bg-slate-950`, `text-slate-100`) through every
 * page and component — which is why re-skinning this app is a
 * codebase-wide edit rather than a one-file change. Anything built from
 * here on should reach for these, so the NEXT re-skin is one file.
 *
 * `rail` stays dark on purpose. The nav rail is the one dark surface in
 * the light theme: a dark rail against a light canvas is what makes the
 * chrome recede and the work come forward.
 *
 * `brand` is the founder-approved yellow (#facc15). It is a FILL colour
 * that always carries a dark label — see the notes on `brand` and `link`
 * below before using it for text.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // LIGHT — the yellow/black/white palette chosen from the approved
        // mockups (2026-09-11). Values are exact from the mockups; do not
        // improvise here. Cards are white with 1px #171717 outlines — the
        // black outline is a deliberate style choice, so `line-card` is
        // black on purpose while `line-row` is the soft divider inside a
        // card.
        canvas: "#ffffff",
        surface: "#ffffff",
        rail: "#171717", // charcoal, not navy
        "rail-hover": "#262626",

        "line-card": "#171717", // 1px black card outlines
        "line-row": "#d6d3d1", // row dividers inside cards

        ink: "#0a0a0a", // primary text, headings, money — 19.8:1 on canvas
        "ink-label": "#171717", // labels, section headers — 17.9:1
        "ink-body": "#404040", // secondary text — 10.4:1
        // Optional text only: placeholders, disabled controls. 4.7:1.
        "ink-muted": "#737373",

        // Brand yellow. As a FILL it does not clear 3:1 against the white
        // canvas — accepted, because every brand fill carries a #171717
        // label at 600-700 weight (9.5:1), which is what the eye reads.
        // Never put white text on this.
        brand: "#facc15",

        // Links are NOT the brand yellow — yellow text on white is
        // unreadable. Links are the dark gold pair from the mockups.
        link: "#a16207",
        "link-hover": "#854d0e",

        // Accent bars, for summary cards only. Plain cards get no bar —
        // a colour on everything is a colour that says nothing.
        // Semantic colours unchanged by the re-skin.
        "bar-rose": "#f04438",
        "bar-amber": "#f79009",
        "bar-green": "#12b76a",
        "bar-blue": "#3b82f6",
        "bar-indigo": "#6366f1",
        "bar-violet": "#8b5cf6",
        "bar-teal": "#14b8a6",

        // Tag pairs: light grounds under dark inks. Semantic pairs keep
        // their meanings (error red, success green, warning amber);
        // tag-blue is the brand/status-positive chip ("In progress"):
        // #facc15 ground, #422006 ink, 9.5:1. tag-slate is the neutral
        // chip — white ground, #171717 ink; callers add the 1px
        // border-line-card outline that makes it visible on a white card.
        "tag-rose": "#fef3f2",
        "tag-rose-ink": "#b42318",
        "tag-amber": "#fef0c7",
        "tag-amber-ink": "#b54708",
        "tag-green": "#d1fadf",
        "tag-green-ink": "#05603a",
        "tag-blue": "#facc15",
        "tag-blue-ink": "#422006",
        "tag-slate": "#ffffff",
        "tag-slate-ink": "#171717",

        // Soft brand chip (avatar etc.).
        "tag-brand-soft": "#fef3c7",
        "tag-brand-soft-ink": "#854d0e",
      },
    },
  },
  plugins: [],
};

export default config;
