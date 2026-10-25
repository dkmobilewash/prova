import type { ReactNode } from "react";

/**
 * The placeholder for a Bid screen that is not ported yet. Says so plainly —
 * "coming in this build" — rather than rendering an empty list that reads as
 * a broken feature (CLAUDE.md: an empty page in a preview is indistinguishable
 * from a defect). The porting brief for each screen lives in a comment at the
 * top of its page file, beside this call, so the next person finds it where
 * they will be editing.
 */
export function BidComingSoon({
  title,
  purpose,
  children,
  level = 1,
}: {
  title: string;
  /** 1 when the stub IS the page; 2 when it sits under a page's own heading. */
  level?: 1 | 2;
  /** What the screen is for, in a sentence a sub would say. */
  purpose: ReactNode;
  /** Optional: what already works today, honestly. */
  children?: ReactNode;
}) {
  return (
    <div>
      {level === 1 ? (
        <h1 className="mb-2 font-headline text-3xl font-semibold text-ink">{title}</h1>
      ) : (
        <h2 className="mb-2 text-lg font-semibold text-ink">{title}</h2>
      )}
      <div className="max-w-prose text-sm text-ink-body">{purpose}</div>
      <div className="mt-6 max-w-prose rounded-lg border border-dashed border-line-card bg-surface p-4">
        <p className="text-sm font-semibold text-ink-label">Coming in this build</p>
        <p className="mt-1 text-sm text-ink-body">
          This screen is being moved into C Stream Bid. Nothing you enter elsewhere is lost — it is the same
          account.
        </p>
        {children}
      </div>
    </div>
  );
}
