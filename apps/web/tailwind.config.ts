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
        canvas: "#f5f6f8",
        surface: "#ffffff",
        rail: "#0f172a",
        "rail-hover": "#1e293b",

        "line-card": "#e4e7ec",
        "line-row": "#f0f2f5",

        ink: "#101828",
        "ink-label": "#344054",
        "ink-body": "#667085",
        "ink-muted": "#98a2b3",

        brand: "#2563eb",

        // Accent bars, for summary cards only. Plain cards get no bar —
        // a colour on everything is a colour that says nothing.
        "bar-rose": "#f04438",
        "bar-amber": "#f79009",
        "bar-green": "#12b76a",
        "bar-blue": "#2563eb",
        "bar-indigo": "#4f46e5",
        "bar-violet": "#7c3aed",
        "bar-teal": "#0d9488",

        // Tag pairs: light ground, saturated text. Not solid fills — a
        // page of solid badges reads as an alarm rather than a status.
        "tag-rose": "#fee4e2",
        "tag-rose-ink": "#b42318",
        "tag-amber": "#fef0c7",
        "tag-amber-ink": "#b54708",
        "tag-green": "#d1fadf",
        "tag-green-ink": "#05603a",
        "tag-blue": "#d1e9ff",
        "tag-blue-ink": "#175cd3",
        "tag-slate": "#f2f4f7",
        "tag-slate-ink": "#475467",
      },
    },
  },
  plugins: [],
};

export default config;
