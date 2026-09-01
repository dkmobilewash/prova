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

/** Retainage withheld and not yet released. All of it.
 *
 * Three filters were tried here and two were wrong.
 *
 * Job status was the original bug (#46): summed over CONTRACTED and
 * IN_PROGRESS only, so a card about money released at the END of a job
 * could never show anything.
 *
 * A calendar month was the first fix's mistake: retainage is chased for
 * months, and a figure that resets on the 1st reports nothing owed on the
 * day it is most owed.
 *
 * Substantial completion was the second, and it is the subtle one.
 * `Job.substantialCompletionDate` is the date a job is EXPECTED to reach
 * substantial completion — a forecasting anchor, not a record that it
 * happened. Requiring it excluded real money held on jobs nobody had
 * forecast yet, and the caption built on it ("on jobs past substantial
 * completion") was describing an event the column does not record.
 *
 * So: no filter. Withheld minus released is money the GC is holding,
 * whatever stage the job is at and whether or not anyone has estimated
 * when it comes back. WHEN it is expected is a separate question, and
 * /cash-flow already answers it using that date for what it is — a
 * forecast.
 */
export function totalRetainageHeld(rows: RetainageHeldRow[]): number {
  return rows.reduce(
    (sum, row) =>
      sum +
      calculateRetainageSummary({
        invoiceRetainageWithheld: row.invoiceRetainageWithheld,
        releaseAmounts: row.releaseAmounts,
        substantialCompletionDate: row.substantialCompletionDate,
      }).balance,
    0,
  );
}
