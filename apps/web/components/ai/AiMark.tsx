/**
 * The AI word's spark and its open-findings badge — shared by the desktop
 * top bar and the phone's bottom tabs so the two cannot draw different
 * marks for the same page. Server-safe; no state.
 */
export function AiSpark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z" />
      <path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </svg>
  );
}

/** Zero draws nothing; the link's own aria-label carries the count. */
export function AiCountBadge({ count, className = "" }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={`min-w-[1.15rem] rounded-full bg-tag-rose px-1 text-center text-[0.65rem] font-semibold leading-[1.15rem] text-tag-rose-ink ring-1 ring-tag-rose-ink/40 tabular-nums ${className}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
