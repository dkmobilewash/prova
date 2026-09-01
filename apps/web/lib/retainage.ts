// Retainage math -- withheld, released, and outstanding balance for a job.
// Pure arithmetic, deliberately not an LLM call, same reasoning as
// lib/wip.ts. Withheld is the sum of what was snapshotted onto each
// Invoice at creation (Invoice.retainageWithheld) -- never recomputed
// live from the job's current retainagePercent, since a rate change
// shouldn't rewrite the retainage history of invoices already issued.

export interface RetainageJobInput {
  invoiceRetainageWithheld: (number | null)[];
  releaseAmounts: number[];
  substantialCompletionDate: Date | null;
}

export interface RetainageSummary {
  totalWithheld: number;
  totalReleased: number;
  balance: number;
  substantialCompletionDate: Date | null;
}

export function calculateRetainageSummary(input: RetainageJobInput): RetainageSummary {
  const totalWithheld = input.invoiceRetainageWithheld.reduce((sum: number, amount) => sum + (amount ?? 0), 0);
  const totalReleased = input.releaseAmounts.reduce((sum, amount) => sum + amount, 0);
  return {
    totalWithheld,
    totalReleased,
    balance: totalWithheld - totalReleased,
    substantialCompletionDate: input.substantialCompletionDate,
  };
}

/** What a job contributes to the "retainage held" figure.
 *
 * Structurally identical to the rows the dashboard query returns, so the
 * summing rule can be tested without a database — which the previous
 * version could not be, and which is why a card that could never show a
 * number shipped and stayed shipped.
 */
export type RetainageHeldRow = {
  substantialCompletionDate: Date | null;
  invoiceRetainageWithheld: (number | null)[];
  releaseAmounts: number[];
};

/** Retainage withheld and not yet released, on jobs that have reached
 * substantial completion.
 *
 * Deliberately not filtered by job status: retainage becomes claimable at
 * substantial completion, by which point a job is usually COMPLETE. The
 * dashboard previously summed this over CONTRACTED and IN_PROGRESS jobs
 * only, so the card could never show anything.
 *
 * Deliberately not filtered by calendar month either. Retainage is chased
 * for months; a figure that resets on the 1st reports nothing owed on the
 * day it is most owed.
 */
export function totalRetainageHeld(rows: RetainageHeldRow[]): number {
  return rows.reduce((sum, row) => {
    if (row.substantialCompletionDate === null) return sum;
    return (
      sum +
      calculateRetainageSummary({
        invoiceRetainageWithheld: row.invoiceRetainageWithheld,
        releaseAmounts: row.releaseAmounts,
        substantialCompletionDate: row.substantialCompletionDate,
      }).balance
    );
  }, 0);
}
