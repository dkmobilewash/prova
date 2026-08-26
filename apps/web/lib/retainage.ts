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
