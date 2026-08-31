import defaultTheme from "tailwindcss/defaultTheme";

/**
 * Widths that JavaScript and CSS both have to agree about.
 *
 * The receivables panel is `hidden … lg:flex`, so CSS decides whether it
 * can be seen; the row's click handler decides whether to open it or to
 * navigate to the job instead. When those two disagree, rows in the gap do
 * nothing at all — no panel, no navigation, no error. That shipped: the
 * handler asked for 1024px while the desktop layout returned at 768px, and
 * every row between those widths was silently dead. Browser testing found
 * it; nothing else could have.
 *
 * Derived from Tailwind's own scale rather than written out again, so the
 * pair cannot drift. If a `screens` override is ever added to
 * tailwind.config.ts, these follow it and the tests below still hold.
 */

const screens = defaultTheme.screens as Record<string, string>;

/** The panel is `lg:flex`. Below this it does not exist, whatever JS thinks. */
export const PANEL_MIN_WIDTH = `(min-width: ${screens.lg})`;

/** The mobile nav is `md:hidden`; the rail returns at this width. */
export const DESKTOP_NAV_MIN_WIDTH = `(min-width: ${screens.md})`;

/** True when the panel can actually be rendered.
 *
 * Read at click time rather than render time: no hydration mismatch, and
 * it follows a window that was resized after the page loaded. Returns true
 * on the server so nothing depends on a guess made without a viewport. */
export function panelCanBeShown(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(PANEL_MIN_WIDTH).matches;
}
