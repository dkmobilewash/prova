"use client";

/**
 * STUB — the search agent owns this file (cyrus/g-search) and its version
 * replaces this one at merge. Same export and props; clicking opens the
 * palette through the shared `cstream:open-search` event.
 */
export function SearchTrigger({ size }: { size: "sm" | "lg" }) {
  const open = () =>
    window.dispatchEvent(new CustomEvent("cstream:open-search", { detail: { query: "" } }));
  const lg = size === "lg";
  return (
    <button
      type="button"
      onClick={open}
      className={`flex w-full items-center gap-3 border border-line-card bg-surface text-left text-ink-muted ${
        lg ? "h-[58px] rounded-2xl px-5 text-[17px] shadow-lg" : "h-[38px] rounded-[10px] px-3 text-sm"
      }`}
    >
      <svg aria-hidden width={lg ? 22 : 16} height={lg ? 22 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <span className="min-w-0 flex-1 truncate">{lg ? "Search a job, or ask" : "Search or ask…"}</span>
      <kbd className="hidden rounded-md border border-line-card px-1.5 py-0.5 text-xs text-ink-muted md:inline">⌘K</kbd>
    </button>
  );
}
