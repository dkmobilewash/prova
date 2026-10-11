import type { Config } from "tailwindcss";
import type { PluginAPI } from "tailwindcss/types/config";

/**
 * Semantic colour tokens, dark by default with a light palette below (2026-10-10).
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
const dark = {
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
  // Hover on a brand FILL: yellow-500, the value 136 buttons already use as
  // a raw `hover:bg-yellow-500`. Same dark label (10.3:1). Same in both themes.
  "brand-hover": "#eab308",

  // Links are the gold — yellow-on-dark is readable (10.0:1 on
  // canvas), unlike yellow-on-white, so links no longer need the
  // darkened #a16207 the light theme used. Hover brightens to the
  // brand yellow itself.
  link: "#eab308",
  "link-hover": "#facc15",

  // Tag pairs: dark grounds under light inks — the dark-ground
  // versions of the same hues, so semantic MEANINGS are unchanged
  // (error red, success green, warning amber). tag-brand is the
  // brand/status-positive chip ("In progress") and is the one pair
  // that keeps a LIGHT ground: #facc15 fill, #422006 ink, 9.5:1 —
  // yellow fills keep dark text everywhere.
  //
  // IT WAS CALLED `tag-blue` UNTIL 2026-10-10 AND IT HAS NEVER BEEN
  // BLUE. The hue was deliberate and documented; the NAME was the
  // defect, and a name that contradicts its own value three lines
  // below it is the cheapest kind of trap this repo keeps paying for.
  // Renamed to pair with `tag-brand-soft` further down, which is the
  // dark-ground version of the same chip — so the `-soft` suffix now
  // means something relative to something.
  //
  // A missed call site would have rendered UNSTYLED rather than
  // wrong-coloured, since a Tailwind class naming no token resolves to
  // nothing. `colorTokenCensus.test.ts` is what makes that loud: it
  // fails on any class pointing at a token this file does not define.
  // tag-slate is the
  // neutral/info chip on the mockups' info-blue pair; callers add
  // the 1px border-line-card outline that keeps it visible.
  "tag-rose": "#3a1518",
  "tag-rose-ink": "#f97066",
  "tag-amber": "#3a2a08",
  "tag-amber-ink": "#f0c464",
  "tag-green": "#143a26",
  "tag-green-ink": "#7ee2a8",
  "tag-brand": "#facc15",
  "tag-brand-ink": "#422006",
  "tag-slate": "#23282f",
  "tag-slate-ink": "#9fb6c9",

  // Soft brand chip (avatar etc.): dark gold ground, brand-yellow
  // ink — 9.9:1, and yellow as text is fine on a ground this dark.
  "tag-brand-soft": "#2e2508",
  "tag-brand-soft-ink": "#facc15",

  // Status text, for words that carry a verdict: an error, a warning, a
  // "done". Exact Tailwind values the app was already using as raw
  // utilities (red-400, amber-400, green-400) so the dark theme did not move
  // when they became tokens — 6.3, 10.4 and 10.0 on surface.
  danger: "#f87171",
  warn: "#fbbf24",
  ok: "#4ade80",

  // The stronger hover lift (secondary buttons that already sit on
  // rail-hover). neutral-700, exactly what those buttons used.
  lift: "#404040",

  // Keyboard focus ring. The brand yellow on dark (12.5:1 on canvas); on the
  // light palette it is darkened, since #facc15 on white is 1.5:1 and a
  // focus ring is held to the 3:1 non-text floor.
  focus: "#facc15",
};

/**
 * LIGHT — for reading outdoors on a phone (2026-10-10). Opt-in through the
 * theme switch, or followed from the OS. Floors this palette is held to by
 * `theme-contrast.test.ts`, on every ground text is painted on:
 * ink/ink-label/ink-body at 7:1 or better, ink-muted 4.5:1, status text and
 * links 4.5:1, and card outlines 3:1 — a 1px grey that reads on a monitor
 * vanishes in sun. Brand stays the same yellow FILL with a dark label; as
 * TEXT it is darkened (`link`, `link-hover`), since yellow on white is 1.5:1.
 */
const light: Record<keyof typeof dark, string> = {
  canvas: "#f2f2f2",
  surface: "#ffffff",
  rail: "#fafafa",
  "rail-hover": "#e5e5e5",
  "line-card": "#808080", // 3.5 on canvas, 4.0 on surface
  "line-row": "#d4d4d4",
  ink: "#0a0a0a", // 17.7 on canvas
  "ink-label": "#171717", // 16.0
  "ink-body": "#262626", // 13.5
  "ink-muted": "#525252", // 6.8
  brand: "#facc15",
  // Hover on a brand FILL: yellow-500, the value 136 buttons already use as
  // a raw `hover:bg-yellow-500`. Same dark label (10.3:1). Same in both themes.
  "brand-hover": "#eab308",
  link: "#854d0e", // 6.1 on canvas
  "link-hover": "#713f12", // 7.8
  "tag-rose": "#fee4e2",
  "tag-rose-ink": "#912018",
  "tag-amber": "#fef0c7",
  "tag-amber-ink": "#7a2e0e",
  "tag-green": "#d1fadf",
  "tag-green-ink": "#05603a",
  "tag-brand": "#facc15",
  "tag-brand-ink": "#422006",
  "tag-slate": "#eaecf0",
  "tag-slate-ink": "#344054",
  "tag-brand-soft": "#fef7c3",
  "tag-brand-soft-ink": "#713f12",
  danger: "#b91c1c",
  warn: "#92400e",
  ok: "#166534",
  lift: "#d4d4d4",
  focus: "#a16207", // 4.4 on canvas, 4.9 on surface
};

export const palette = { dark, light };

/** `#0f0f0f` -> `15 15 15`, the form `rgb(var(--x) / a)` needs. */
const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
const vars = (p: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(p).map(([name, hex]) => [`--c-${name}`, channels(hex)]),
  );

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // The display face, wired from `next/font` in app/layout.tsx — which
        // is where the measurements and the reason for a condensed face are
        // written down. `headline`, not `display`, because `font-display` as
        // a class name reads like the CSS descriptor of the same name and
        // this is a family, not a loading strategy.
        //
        // The fallback list is the stack this whole app rendered in before
        // there was a face at all, so a failed font file is the status quo
        // rather than Times New Roman. `var(--font-headline)` resolves to
        // next/font's own size-adjusted fallback first and the real file
        // once it lands.
        headline: [
          "var(--font-headline)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        // Every themed token is a CSS variable holding RGB channels, so
        // opacity modifiers (`bg-brand/15`) keep working. The values live in
        // `palette` above and are emitted by the plugin below — one source,
        // which is also the one `theme-contrast.test.ts` measures.
        ...Object.fromEntries(
          Object.keys(palette.dark).map((name) => [
            name,
            `rgb(var(--c-${name}) / <alpha-value>)`,
          ]),
        ),

        // Accent bars, for summary cards only. Plain cards get no bar —
        // a colour on everything is a colour that says nothing.
        // Semantic colours unchanged by the re-skin, and the same in both
        // themes — a decorative accent, never text.
        "bar-rose": "#f04438",
        "bar-amber": "#f79009",
        "bar-green": "#12b76a",
        "bar-blue": "#3b82f6",
        "bar-indigo": "#6366f1",
        "bar-violet": "#8b5cf6",
        "bar-teal": "#14b8a6",
      },
    },
  },
  plugins: [
    // Dark is the default at :root, so a page with no script — or a theme
    // switch that never ran — renders exactly the dark app it always was.
    ({ addBase }: PluginAPI) => {
      addBase({
        ":root": vars(palette.dark),
        '[data-theme="light"]': vars(palette.light),
      });
    },
    // `mouse:` — a primary pointer that is precise. A control written
    // `min-h-11 mouse:min-h-8` stays 44px on a touch screen and gets dense
    // under a mouse, at any width (the compact pass, 2026-10-11). The same
    // test globals.css uses for its touch floors, inverted.
    ({ addVariant }: PluginAPI) => {
      addVariant("mouse", "@media (pointer: fine)");
    },
  ],
};

export default config;
