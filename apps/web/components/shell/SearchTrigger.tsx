"use client";

/**
 * STUB — the search agent owns this file (Concept G contract). Same export
 * and props as the real one; main takes the search agent's version at merge.
 * Clicking dispatches the shared open-search event.
 */
export function SearchTrigger({ size }: { size: "sm" | "lg" }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("cstream:open-search", { detail: { query: "" } }))}
      className={
        size === "sm"
          ? "flex h-[38px] w-[300px] items-center gap-2.5 rounded-[10px] border border-line-card bg-surface pl-[13px] pr-2.5 text-sm text-ink-muted"
          : "flex h-[58px] w-full items-center gap-3.5 rounded-2xl border border-line-card bg-surface px-5 text-[17px] text-ink-muted"
      }
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4 shrink-0" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <span className="flex-1 text-left">Search or ask…</span>
      <kbd className="rounded-md border border-line-card px-[7px] py-1 text-xs leading-none text-ink-muted">⌘K</kbd>
    </button>
  );
}
