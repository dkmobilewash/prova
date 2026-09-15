import type { Config } from "tailwindcss";

/**
 * Semantic colour tokens for the dark theme.
 *
 * Named for their job rather than their value, because the previous pass
 * scattered raw utilities (`bg-slate-950`, `text-slate-100`) through every
 * page and component — which is why re-skinning this app is a
 * codebase-wide edit rather than a one-file change. Anything built from
 * here on should reach for these, so the NEXT re-skin is one file.
 *
 * `rail` is slightly LIFTED from the canvas on purpose (#171717 on
 * #0f0f0f). The chrome no longer recedes by being the one dark surface;
 * it recedes by being quiet, and the lift is what keeps it readable as a
 * distinct column instead of dissolving into the page.
 *
 * `brand` is the founder-approved yellow (#facc15). It is a FILL colour
 * that always carries a dark label — see the notes on `brand` and `link`
 * below before using it for text as a fill; as TEXT it is fine on these
 * dark grounds, which is what `link-hover` uses.
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
        // DARK — the palette from the approved dark mockups (2026-09-11,
        // the "MainVision / Money Rail" set). Values are exact from the
        // mockups; do not improvise here. Cards are #1a1a1a with 1px
        // #3d3d3d outlines — soft grey on purpose, NEVER pure white or
        // pure black borders on these grounds: white glares, black
        // disappears. `line-row` is the softer divider inside a card.
        canvas: "#0f0f0f",
        surface: "#1a1a1a",
        rail: "#171717", // charcoal, not navy — lifted off the canvas
        "rail-hover": "#262626",

        "line-card": "#3d3d3d", // 1px soft grey card outlines
        "line-row": "#2e2e2e", // row dividers inside cards

        ink: "#fafafa", // primary text, headings, money — 18.4:1 on canvas
        "ink-label": "#e5e5e5", // labels, section headers — 15.2:1
        "ink-body": "#d4d4d4", // secondary text — 12.9:1
        // Optional text only: placeholders, disabled controls. 7.6:1.
        "ink-muted": "#a3a3a3",

        // Brand yellow, unchanged by the flip. Every brand FILL carries a
        // dark #171717 label at 600-700 weight (9.5:1) — buttons, the
        // logo chip, "In progress" chips. Never put white text on this.
        brand: "#facc15",

        // Links are the gold — yellow-on-dark is readable (10.0:1 on
        // canvas), unlike yellow-on-white, so links no longer need the
        // darkened #a16207 the light theme used. Hover brightens to the
        // brand yellow itself.
        link: "#eab308",
        "link-hover": "#facc15",

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

        // Tag pairs: dark grounds under light inks — the dark-ground
        // versions of the same hues, so semantic MEANINGS are unchanged
        // (error red, success green, warning amber). tag-blue is the
        // brand/status-positive chip ("In progress") and is the one pair
        // that keeps a LIGHT ground: #facc15 fill, #422006 ink, 9.5:1 —
        // yellow fills keep dark text everywhere. tag-slate is the
        // neutral/info chip on the mockups' info-blue pair; callers add
        // the 1px border-line-card outline that keeps it visible.
        "tag-rose": "#3a1518",
        "tag-rose-ink": "#f97066",
        "tag-amber": "#3a2a08",
        "tag-amber-ink": "#f0c464",
        "tag-green": "#143a26",
        "tag-green-ink": "#7ee2a8",
        "tag-blue": "#facc15",
        "tag-blue-ink": "#422006",
        "tag-slate": "#23282f",
        "tag-slate-ink": "#9fb6c9",

        // Soft brand chip (avatar etc.): dark gold ground, brand-yellow
        // ink — 9.9:1, and yellow as text is fine on a ground this dark.
        "tag-brand-soft": "#2e2508",
        "tag-brand-soft-ink": "#facc15",
      },
    },
  },
  plugins: [],
};

export default config;
