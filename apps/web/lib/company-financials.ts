import { calculateJobWip, type WipJobResult } from "./wip";

/**
 * The four numbers across every active job, for the bar at the bottom of
 * the screen.
 *
 * Sheet 15 has flagged "no company-wide backlog report" since the first
 * audit: every figure below already existed per job and nothing summed
 * them. An owner could see whether one job was healthy and had no way to
 * ask whether the business was.
 *
 * Derived on every read, never stored. Same rule as lib/wip.ts and every
 * other computed total in this codebase — a cached margin is wrong the
 * moment a cost entry lands, and a stale number on a bar someone glances
 * at is worse than no bar.
 *
 * Pure: takes already-computed per-job WIP results and payment figures,
 * returns arithmetic. No Prisma, no dates, no I/O.
 */

export interface CompanyFinancialsInput {
  /** One per active job, from calculateJobWip. */
  jobs: WipJobResult[];
  /** SUM(Payment.amount) across every invoice in the company. */
  cashCollected: number;
  /** SUM(Invoice.amount) across every invoice raised. */
  totalBilled: number;
  /** Outstanding retainage across jobs, from calculateRetainageSummary. */
  retainageBalances: number[];
}

export interface CompanyFinancials {
  /** Contract value across active jobs — the backlog figure Sheet 15 asks
   * for. Contract value, not earned revenue: this is what the company has
   * sold, which is the question "what is our backlog" means. */
  estimatedRevenue: number;
  /** Earned revenue minus cost incurred, over earned revenue. Blended
   * across jobs by summing both sides first rather than averaging each
   * job's margin — a $2M job and a $20k job are not equal evidence of how
   * the business is doing. Null when nothing has been earned yet, because
   * a margin on zero revenue is a division, not a fact. */
  grossMarginRate: number | null;
  grossProfit: number;
  /** Billed and collected, less what is still owed. Cash in the door. */
  cashPosition: number;
  /** Billed but not yet paid — the money the margin above has already
   * counted and the bank has not seen. */
  outstandingReceivable: number;
  retainageHeld: number;
}

export function calculateCompanyFinancials(input: CompanyFinancialsInput): CompanyFinancials {
  const estimatedRevenue = input.jobs.reduce((sum, job) => sum + job.contractValue, 0);
  const earnedRevenue = input.jobs.reduce((sum, job) => sum + job.earnedRevenue, 0);
  const costToDate = input.jobs.reduce((sum, job) => sum + job.actualCostToDate, 0);

  const grossProfit = earnedRevenue - costToDate;

  return {
    estimatedRevenue,
    grossProfit,
    grossMarginRate: earnedRevenue > 0 ? grossProfit / earnedRevenue : null,
    cashPosition: input.cashCollected,
    outstandingReceivable: input.totalBilled - input.cashCollected,
    retainageHeld: input.retainageBalances.reduce((sum, balance) => sum + balance, 0),
  };
}

/**
 * Is a job's cost trending past what it was sold for?
 *
 * Compares the forecast cost at completion against contract value, not
 * cost-to-date against budget. A job that has spent 40% of its budget at
 * 20% complete is in trouble now; waiting until it has spent 100% to say
 * so makes the warning useless.
 *
 * Null when the job has no cost estimate at all — that is "we don't know",
 * and reporting "we don't know" as "on budget" is how a figure loses its
 * meaning.
 */
export function jobIsOverBudget(job: WipJobResult): boolean | null {
  if (job.estimatedCostAtCompletion <= 0) return null;
  if (job.contractValue <= 0) return null;
  return job.estimatedCostAtCompletion > job.contractValue;
}

/**
 * How far past, as a share of contract value. Positive means over.
 * Null on the same "we don't know" grounds as above.
 */
export function jobCostVariance(job: WipJobResult): number | null {
  if (job.estimatedCostAtCompletion <= 0 || job.contractValue <= 0) return null;
  return (job.estimatedCostAtCompletion - job.contractValue) / job.contractValue;
}

/**
 * The threshold above which a margin is worth colouring green.
 *
 * A number that is always green teaches people to stop reading it. 35%
 * gross on self-performed specialty work is genuinely good; below it is
 * ordinary and should look ordinary.
 */
export const HEALTHY_MARGIN_RATE = 0.35;

export function marginIsHealthy(rate: number | null): boolean {
  return rate !== null && rate > HEALTHY_MARGIN_RATE;
}

/**
 * One job's health as a sentence, because a bare variance percentage on a
 * dashboard row is a number nobody acts on.
 */
export function jobHealthSentence(job: {
  name: string;
  wip: WipJobResult;
}): { tone: "over" | "watch" | "fine" | "unknown"; sentence: string } {
  const variance = jobCostVariance(job.wip);
  if (variance === null) {
    return {
      tone: "unknown",
      sentence: "No cost estimate yet, so there is nothing to compare against.",
    };
  }

  const percentComplete = job.wip.percentComplete;
  const progress =
    percentComplete === null ? "" : ` at ${Math.round(percentComplete * 100)}% complete`;

  if (variance > 0.05) {
    return {
      tone: "over",
      sentence: `Forecast to finish ${Math.round(variance * 100)}% over contract value${progress}.`,
    };
  }
  if (variance > 0) {
    return {
      tone: "watch",
      sentence: `Forecast to finish just over contract value${progress}.`,
    };
  }
  return {
    tone: "fine",
    sentence: `Forecast to finish ${Math.abs(Math.round(variance * 100))}% under contract value${progress}.`,
  };
}

/** Re-exported so a caller building company figures doesn't need to import
 * from two places to do one job. */
export { calculateJobWip };
