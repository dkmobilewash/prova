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
 * server cannot know the reader's platform, so the first render always says
 * the server's answer ("Ctrl K") and an effect swaps in "⌘K" on a Mac.
 * Reading it during render was a hydration mismatch on every page for every
 * Mac user, for as long as the old top-bar search box had it that way
 * (c538c3ad); a Mac user now sees "Ctrl K" for one frame instead.
 */
function useShortcutLabel(): string {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ""));
  }, []);
  return mac ? "⌘K" : "Ctrl K";
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
  const kbd = (
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
