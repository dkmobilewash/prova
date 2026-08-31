import { describe, expect, it } from "vitest";
import defaultTheme from "tailwindcss/defaultTheme";
import { DESKTOP_NAV_MIN_WIDTH, PANEL_MIN_WIDTH, panelCanBeShown } from "./breakpoints";

const screens = defaultTheme.screens as Record<string, string>;

/** The dead band: the click handler asked for one width and the CSS that
 * decides whether the panel exists used another, so every row between them
 * did nothing at all — no panel, no navigation, no error. These lock the
 * two numbers to one source. */
describe("breakpoints", () => {
  it("matches the panel's own lg: class", () => {
    // SidePanel is `hidden … lg:flex`. If this pair ever disagrees, rows
    // in the gap go dead again.
    expect(PANEL_MIN_WIDTH).toBe(`(min-width: ${screens.lg})`);
  });

  it("matches the nav's md: breakpoint", () => {
    // MobileNav is `md:hidden`.
    expect(DESKTOP_NAV_MIN_WIDTH).toBe(`(min-width: ${screens.md})`);
  });

  it("leaves a band where the desktop layout is up but the panel is not", () => {
    // Not a bug — it is the reason the click handler needs a fallback at
    // all. Asserting it so nobody "simplifies" the fallback away on the
    // assumption that desktop implies panel.
    const md = Number.parseInt(screens.md, 10);
    const lg = Number.parseInt(screens.lg, 10);
    expect(Number.isFinite(md) && Number.isFinite(lg)).toBe(true);
    expect(lg).toBeGreaterThan(md);
  });

  it("assumes the panel is available with no window, rather than guessing", () => {
    // Server render: there is no viewport, so it must not decide the panel
    // is unavailable and bake that into the markup.
    expect(typeof window).toBe("undefined");
    expect(panelCanBeShown()).toBe(true);
  });
});
