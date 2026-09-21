"use client";

import { useEffect, useRef, useState } from "react";

type RevealState = "idle" | "pending" | "visible";

/**
 * Reveals its children as they scroll into view — small, considered
 * motion, not an animation the reader is meant to notice. Used on the
 * public landing page (components/LandingPage.tsx) below the hero, which
 * is never wrapped in this: nothing above the fold should fade in on load,
 * that reads as lag rather than polish.
 *
 * SAFE AT REST BY CONSTRUCTION, not by convention. React state starts at
 * "idle", which the CSS (globals.css) treats IDENTICALLY to "visible" —
 * full opacity, no transform, the same markup a server render or a browser
 * with JS disabled produces. The only path to a hidden state is the
 * observer's own callback POSITIVELY reporting the element is not yet on
 * screen — so if IntersectionObserver is unsupported, disabled, or its
 * callback never fires at all, the element simply stays "idle": visible,
 * forever. Nothing here can render at rest as `opacity: 0` waiting on an
 * event that might not come — the failure mode this file exists to rule
 * out (see CLAUDE.md's "a watcher whose needle is already on the page"
 * and the reveal-motion brief this component was built from: "everything
 * visible at rest, never parked at opacity 0 waiting on an observer that
 * may not fire").
 *
 * A 4-second timer is a second, independent net: if something DID go
 * "pending" (confirmed off-screen) and the observer then never calls back
 * again — a stalled tab, a browser bug — the timer forces "visible" rather
 * than leaving it hidden indefinitely.
 *
 * prefers-reduced-motion is asserted twice, deliberately redundant: here,
 * in JS, the observer is never even created, so state can never leave
 * "idle"; independently, in globals.css, the CSS that hides "pending" and
 * transitions "visible" lives entirely inside
 * `@media (prefers-reduced-motion: no-preference)`, so a bug in this file
 * could not make anything move or hide for a reader who asked for less
 * motion. Tests for both layers: Reveal.test.ts (this file) and
 * app/globals.reveal.test.ts (the CSS).
 */
export function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RevealState>("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let settled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          settled = true;
          setState("visible");
          observer.disconnect();
        } else {
          setState((prev) => (prev === "idle" ? "pending" : prev));
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);

    const timeout = window.setTimeout(() => {
      if (!settled) setState("visible");
    }, 4000);

    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, []);

  return (
    <div ref={ref} data-reveal={state} className={className}>
      {children}
    </div>
  );
}
