"use client";

import { useEffect, useRef, useState } from "react";
import { AskPanel } from "@/components/AskPanel";

/**
 * Ask, from anywhere.
 *
 * The assistant is the most distinctive thing in this product and it lived
 * on exactly one screen — the dashboard. So a foreman standing on a punch
 * list who wants to ask a question had to navigate home first, which is the
 * friction that stops a feature being used at all. Cyrus called it while
 * staging the demo: "they shouldn't have to navigate all the way back to
 * that page to use the AI."
 *
 * This is the SAME `<AskPanel />` the dashboard and /ask render, not a
 * reduced copy. That is deliberate: a cut-down version would answer fewer
 * questions than the full one and nobody would know which they were
 * talking to. It takes no props, so there is nothing to keep in sync.
 *
 * Mounted in the Topbar, so it is on every page inside the app shell.
 */
export function AskLauncher() {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  // Escape closes, and a click anywhere outside closes. Both are what a
  // person expects of a thing that opened over the page; without them the
  // panel is a trap you have to find the button again to leave.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (holder.current && !holder.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={holder} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-ask-launcher
        className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-ink-body hover:bg-rail-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
          <path
            d="M10 2.5 11.6 7l4.4 1.6L11.6 10 10 14.5 8.4 10 4 8.6 8.4 7 10 2.5Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
        <span className="hidden sm:inline">Ask C Stream</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Ask C Stream"
          // Viewport-FIXED, the same pattern as HelpButton beside it, and
          // width-capped rather than full-bleed: this is a question box,
          // not a takeover. It was `absolute right-0` off the ~44px button
          // for a while, which anchored the panel's RIGHT edge to the
          // button rather than the screen — at 375px the 343px panel's
          // left side hung well off-screen, clipping the input and the
          // proposal preview on every page.
          className="fixed right-2 top-14 z-50 max-h-[calc(100dvh-4.5rem)] w-[min(34rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-line-card bg-surface p-4 shadow-2xl sm:right-4"
        >
          <AskPanel />
        </div>
      ) : null}
    </div>
  );
}
