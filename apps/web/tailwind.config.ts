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
 * `brand` is unchanged blue-600. The re-skin changes surfaces and tags,
 * not Prova's own accent.
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
        // DARK. These were light values, and the dashboard was the only
        // page using them — 24 of 25 pages are on the raw slate classes,
        // so the one converted screen read as a different application on
        // every click.
        //
        // Repointing the VALUES rather than rewriting 24 pages, and not
        // reverting the dashboard either. The tokens are the right idea;
        // only their colours were premature. A previous attempt at the
        // sweep left 15 of 17 pages unreadable, including white-on-white
        // money on /cash-flow, and doing that again the week of a demo is
        // the worst move available.
        //
        // The light conversion becomes a change to this block once every
        // page uses tokens, instead of a 24-file rewrite with no way to
        // check it. That is the whole point of having tokens.
        //
        // Values match what the unconverted pages already use, so the two
        // halves are literally the same colours: slate-950 page,
        // slate-900 cards, slate-800 lines, slate-100/300/400/500 text.
        canvas: "#020617", // slate-950
        surface: "#0f172a", // slate-900
        rail: "#0f172a",
        "rail-hover": "#1e293b",

        "line-card": "#1e293b", // slate-800
        "line-row": "#1e293b",

        // The dark ramp has more room than the light one did: all four
        // levels clear their floor, where the light theme could only
        // afford three (see theme-contrast.test.ts).
        ink: "#f1f5f9", // slate-100 — 18.4:1 on canvas
        "ink-label": "#cbd5e1", // slate-300 — 13.6:1
        "ink-body": "#94a3b8", // slate-400 — 7.9:1
        // Optional text only: placeholders, disabled controls. 4.2:1 on
        // canvas, 3.8:1 on a card.
        "ink-muted": "#64748b", // slate-500

        // blue-600. I first changed this to blue-500 on the assumption
        // that blue-600 "did not read on dark", then measured: blue-600
        // is 3.9:1 as a fill on the canvas (a UI component needs 3) and
        // carries a WHITE LABEL at 5.2:1. blue-500 looks bolder and its
        // white label is 3.7:1 — under the 4.5 floor for text, which is
        // what a button label is. The bolder one was the unreadable one.
        brand: "#2563eb",

        // Accent bars, for summary cards only. Plain cards get no bar —
        // a colour on everything is a colour that says nothing.
        "bar-rose": "#f04438",
        "bar-amber": "#f79009",
        "bar-green": "#12b76a",
        "bar-blue": "#3b82f6",
        "bar-indigo": "#6366f1",
        "bar-violet": "#8b5cf6",
        "bar-teal": "#14b8a6",

        // Tag pairs, inverted with everything else: a dark translucent
        // ground under a light saturated ink, which is the convention the
        // other 24 pages already use (bg-green-500/15, text-green-300).
        // Left as light chips they would have become the new
        // inconsistency — the same defect one level down.
        //
        // Grounds are the -500 colour composited at 18% over surface, so
        // they sit correctly on a card without needing opacity. Every
        // pair clears 4.5:1; the worst is blue at 7.9.
        "tag-rose": "#371f2f",
        "tag-rose-ink": "#fca5a5",
        "tag-amber": "#382f24",
        "tag-amber-ink": "#fcd34d",
        "tag-green": "#123633",
        "tag-green-ink": "#86efac",
        "tag-blue": "#172a4f",
        "tag-blue-ink": "#93c5fd",
        "tag-slate": "#151f32",
        "tag-slate-ink": "#cbd5e1",
      },
    },
  },
  plugins: [],
};

export default config;
