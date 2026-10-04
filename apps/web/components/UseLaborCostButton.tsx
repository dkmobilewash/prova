"use client";

import { useState, useTransition } from "react";
import { setLineLaborCostFromHours } from "@/lib/actions";
import { money } from "@/lib/money";
import { formatHours } from "@/lib/render-hours";
import type { LaborCostApplyDecision } from "@/lib/estimating/labor-cost-apply";

/**
 * "Use this as the cost" — the way out of a labor line the bid carries at $0.
 *
 * ── IT RENDERS THE DECISION THE ACTION WILL MAKE, NOT ITS OWN ──
 *
 * `decision` comes from `laborCostApplyDecision`, the same pure function the
 * server action re-runs before it writes. The button and the sentence beside it
 * therefore cannot disagree — `catalog-quote-price.ts` states the rule this
 * copies: *"Two implementations of 'the cheapest live quote' is how a button
 * comes to disagree with the badge above it."*
 *
 * The action does NOT trust this. It re-reads the hours, the schedules, the
 * burden and the date server-side and rules again, because the request carries
 * only a line id. This prop decides what is on screen; it never decides what is
 * written.
 *
 * ── WHEN IT SAYS NOTHING ──
 *
 * A refusal is shown only when the line is actually missing its cost. On a line
 * that already carries one, "the budgeted cost already matches" is true and
 * uninteresting, and printing it beside every priced row would be noise on a
 * dense table. Quiet when nothing is wrong; explicit when something is.
 */
export function UseLaborCostButton({
  jobId,
  lineItemId,
  decision,
  inBid,
}: {
  jobId: string;
  lineItemId: string;
  decision: LaborCostApplyDecision;
  /** Whether the line already carries a budgeted cost. */
  inBid: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!decision.ok) {
    // Only worth saying when the cost is missing — see the header.
    if (inBid) return null;
    return <span className="text-xs text-ink-muted">{decision.error}</span>;
  }

  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await setLineLaborCostFromHours(jobId, lineItemId);
            if (!result.ok) setError(result.error);
          });
        }}
        className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50"
      >
        {isPending ? "Setting…" : `Use ${money(decision.unitCost)}/unit as the cost`}
      </button>
      {/* WHAT IT WOULD WRITE, BEFORE IT IS PRESSED. The figure is per UNIT while
          the hint beside it is the line TOTAL, and the two look nothing alike —
          a button that said only "use this" would leave somebody checking the
          wrong number against the meter. */}
      <span className="text-xs text-ink-muted">
        {formatHours(decision.hours)} {decision.hours === 1 ? "hr" : "hrs"} · {money(decision.lineTotal)} on this line
      </span>
      {error && (
        <span role="alert" className="text-xs text-tag-rose-ink">
          {error}
        </span>
      )}
    </span>
  );
}
