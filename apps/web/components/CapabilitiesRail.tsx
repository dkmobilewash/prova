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
export function CapabilitiesRail({ children }: { children: React.ReactNode }) {
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
      aria-label="What C Stream does — six capabilities. Swipe, scroll, or use the arrow keys."
      tabIndex={0}
    >
      {children}
    </div>
  );
}
