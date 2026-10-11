"use client";

import { useEffect, useState } from "react";

/** The one event every "open search" control dispatches; `CommandPalette`
 * listens for it. `query` prefills the box. */
export const OPEN_SEARCH_EVENT = "cstream:open-search";

export function openSearch(query = "") {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: { query } }));
}

/**
 * WHICH SHORTCUT TO NAME, read after hydration and never during render: the
 * server cannot know the reader's platform. Reading it during render was a
 * hydration mismatch on every page for every Mac user (c538c3ad).
 *
 * So the server and the first client render name NO shortcut — null — and
 * the hint appears once the platform is known. Until 2026-10-10 the first
 * render said "Ctrl K" and an effect swapped in "⌘K", which on a Mac was a
 * visible flicker of the wrong key on every page load. A hint that arrives
 * is quieter than one that changes; the box itself never moves, because the
 * hint sits at the far end (`ml-auto`).
 */
function useShortcutLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    setLabel(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "") ? "⌘K" : "Ctrl\u00a0K");
  }, []);
  return label;
}

const Magnifier = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

/**
 * A box that looks like a search field and is a BUTTON: it opens the
 * command palette, where the real input lives. `sm` sits in the top bar;
 * `lg` is the big bar on the home page.
 */
export function SearchTrigger({ size }: { size: "sm" | "lg" }) {
  const shortcut = useShortcutLabel();
  const kbd = shortcut && (
    <span
      aria-hidden="true"
      className="ml-auto hidden shrink-0 rounded-md border border-line-card px-1.5 py-1 text-xs leading-none text-ink-muted sm:inline"
    >
      {shortcut}
    </span>
  );

  if (size === "lg") {
    return (
      <button
        type="button"
        onClick={() => openSearch()}
        aria-label="Search or ask"
        aria-haspopup="dialog"
        data-search-trigger="lg"
        className="flex min-h-14 w-full items-center gap-3.5 rounded-2xl border border-line-card bg-surface px-5 text-left shadow-lg shadow-black/20 hover:border-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Magnifier className="h-[22px] w-[22px] shrink-0 text-ink-muted" />
        <span className="min-w-0 flex-1 truncate text-base text-ink-muted sm:text-[17px]">
          Search a job, or ask — e.g. &ldquo;bill Northgate for October&rdquo;
        </span>
        {kbd}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openSearch()}
      aria-label="Search or ask"
      aria-haspopup="dialog"
      data-search-trigger="sm"
      className="flex min-h-11 w-full items-center gap-2.5 rounded-[10px] border border-line-card bg-canvas px-3 text-left text-sm text-ink-muted hover:border-ink-muted hover:text-ink-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:h-[38px] sm:min-h-0 sm:w-[300px]"
    >
      <Magnifier className="h-4 w-4 shrink-0" />
      <span className="truncate">Search or ask…</span>
      {kbd}
    </button>
  );
}
