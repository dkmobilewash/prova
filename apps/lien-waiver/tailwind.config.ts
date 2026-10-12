import type { Config } from "tailwindcss";

/**
 * Tokens for the waiver tool. A LIGHT page, unlike C-Stream's dark app: the
 * thing being made is a sheet of paper, it is filled in outdoors on a phone,
 * and the preview should look like what will print.
 *
 * Contrast is chosen for sunlight, computed (WCAG relative luminance), not
 * eyeballed: `ink` on `paper` 18.9:1, on `canvas` 17.3:1; `quiet` on
 * `paper` 10.3:1 and on `canvas` 9.4:1 -- both over the 7:1 outdoor floor
 * C-Stream's field rules set; `warn` on `warn-ground` 8.8:1; `danger` on
 * `paper` 8.3:1. `line` is 4.8:1 on `paper`, over the 3:1 floor for a
 * control's border (the first choice, #a8a29e, was 2.5:1). The brand yellow
 * is only ever a FILL under `ink` text (12.3:1), never text on white
 * (1.5:1).
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#ffffff",
        canvas: "#f5f5f4",
        ink: "#111111",
        quiet: "#44403c",
        line: "#78716c",
        brand: "#facc15",
        "brand-hover": "#eab308",
        warn: "#7c2d12",
        "warn-ground": "#fff7ed",
        danger: "#991b1b",
        focus: "#1d4ed8",
      },
      minHeight: {
        touch: "48px",
        primary: "56px",
      },
    },
  },
  plugins: [],
};

export default config;
