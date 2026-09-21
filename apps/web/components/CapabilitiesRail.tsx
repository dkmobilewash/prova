"use client";

import { useRef } from "react";

/**
 * The phone rail's scroll container (components/CapabilitiesSection.tsx).
 * Split out as its own tiny client component for one reason: touch and
 * trackpad already scroll this natively through plain CSS
 * (overflow-x + scroll-snap, see .landing-scroller in globals.css), but
 * measuring this build found that a focused, tabindex=0, horizontally
 * overflowing <div> does NOT scroll on ArrowLeft/ArrowRight in real
 * Chromium — that native "scroll a focused region with the keyboard"
 * behavior some authoring guides describe turned out not to apply here.
 * Tab still reaches the region (confirmed) and a screen reader still
 * reads all six cards regardless of scroll position (confirmed — nothing
 * here is display:none), so the rail was already reachable without this
 * file. This adds the part that was still missing: pressing the arrow
 * keys while it's focused actually moves it, one card at a time.
 *
 * Genuinely optional. If this component's JS never runs, the div behind
 * it is exactly the same overflow-x/scroll-snap container it always was —
 * still focusable, still fully readable, still scrollable by touch or
 * trackpad. This only adds a key handler on top.
 *
 * prefers-reduced-motion: reduce turns off the smooth-scroll animation and
 * jumps instead — the position still changes (this is keyboard operation,
 * not decorative motion), only the animated transition between positions
 * is skipped.
 */
export function CapabilitiesRail({
  children,
  label,
}: {
  /** Optional in the TYPE only, and the reason is worth a line so nobody
   * "tightens" it back. Once `label` became a required prop,
   * `createElement(CapabilitiesRail, null, ...cards)` stopped typechecking
   * — React types the props argument as `Attributes & P`, so a required
   * member makes a partial props object invalid. Moving the children INTO
   * the props object fixes the type and trips `react/no-children-prop`,
   * which is a lint ERROR here and fails the build. Optional children is
   * the one shape that satisfies both: callers still pass cards as
   * ordinary JSX children, and nothing in the app renders this empty. */
  children?: React.ReactNode;
  /** The region's accessible name. REQUIRED, and deliberately has no
   * default: it used to be a string literal in this file that counted the
   * cards ("six capabilities"), which is a number sitting next to a list
   * it cannot see. The list changed length and the label did not. The
   * caller derives it from the data now, so it cannot disagree again. */
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const el = ref.current;
    if (!el) return;
    event.preventDefault();

    const card = el.querySelector<HTMLElement>("[data-rail-card]");
    const gap = 16; // gap-4
    const step = card ? card.getBoundingClientRect().width + gap : el.clientWidth * 0.85;
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    el.scrollBy({
      left: event.key === "ArrowRight" ? step : -step,
      behavior: reduced ? "auto" : "smooth",
    });
  }

  return (
    <div
      ref={ref}
      onKeyDown={onKeyDown}
      className="landing-scroller -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-3"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
