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
   * a margin on zero revenue is a division, not a fact — and now also null
   * when too little of the book carries an earned-revenue figure at all
   * (see earnedCoverage below). */
  grossMarginRate: number | null;
  /** Earned revenue minus cost incurred, over EVERY active job. Deliberately
   * not narrowed to the jobs that clear the coverage threshold: a job whose
   * lines are unestimated has still spent real money, and dropping it from
   * both sums would report a healthy margin for a company that is bleeding.
   * The coverage question is answered by silencing the RATE, never by
   * quietly changing which jobs the sums are over. */
  grossProfit: number;
  /** Share of the company's contract value sitting on lines that produced an
   * earned-revenue figure, 0..1 — value-weighted across jobs, so one small
   * unbudgeted job does not blank the bar for a large estimated book. This
   * is why grossMarginRate can be null while grossProfit is a number. */
  earnedCoverage: number;
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

  // The same refusal jobHealthSentence makes, one level up. Below the
  // threshold the blend is mostly made of jobs assumed to have earned
  // nothing while their cost counts in full, so the rate is an artefact of
  // missing estimates. Value-weighted rather than per-job: a $20k job
  // nobody has budgeted must not blank the bar for a $2M book.
  const coveredValue = input.jobs.reduce((sum, job) => sum + job.earnedCoverage * job.contractValue, 0);
  const earnedCoverage = estimatedRevenue > 0 ? coveredValue / estimatedRevenue : 0;

  return {
    estimatedRevenue,
    grossProfit,
    earnedCoverage,
    grossMarginRate:
      earnedRevenue > 0 && earnedCoverage >= MIN_EARNED_COVERAGE ? grossProfit / earnedRevenue : null,
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

/**
 * How much of a job's contract value must carry a cost estimate before a
 * variance is worth stating.
 *
 * Below this, the forecast is mostly made of lines assumed to cost
 * nothing, and the resulting "X% under budget" is an artefact of missing
 * data rather than a fact about the job.
 */
export const MIN_ESTIMATE_COVERAGE = 0.8;

/**
 * How much of a job's contract value must have produced an earned-revenue
 * figure before an over/under-billing position is worth stating.
 *
 * Same threshold and same reason as MIN_ESTIMATE_COVERAGE, deliberately a
 * SECOND constant rather than a reuse of it. The two ratios have different
 * predicates — a line estimated at zero cost is covered on the cost side and
 * not on the revenue side — and one name would invite someone to answer both
 * questions with one ratio, which is precisely the hole.
 *
 * Below this, the position is mostly made of lines assumed to have earned
 * nothing while their billing counts in full, and "Overbilled $80,000" is an
 * artefact of missing estimates rather than a fact about the job.
 */
export const MIN_EARNED_COVERAGE = 0.8;

/**
 * The billing position, or null for "we don't know" — same convention as
 * jobCostVariance above.
 *
 * Worth knowing what this guard does NOT certify: billedToDate counts
 * billing against every line, covered or not, so at exactly the threshold on
 * a large job a six-figure slice of contract value can still be earning
 * nothing while its invoices count in full. The guard says the estimates are
 * substantially there, not that the dollar figure is exact.
 */
export function jobOverUnderBilling(job: WipJobResult): number | null {
  if (job.earnedCoverage < MIN_EARNED_COVERAGE) return null;
  return job.overUnderBilling;
}

/** Earned revenue, or null on the same grounds. The per-line rows on the job
 * page already render "—" for a line with no earned revenue; this makes the
 * job total behave the way its own rows do. */
export function jobEarnedRevenue(job: WipJobResult): number | null {
  if (job.earnedCoverage < MIN_EARNED_COVERAGE) return null;
  return job.earnedRevenue;
}

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
  /**
   * Share of contract value sitting on lines that actually carry a cost
   * estimate, 0..1.
   *
   * This exists because of a sentence browser testing caught: a job with
   * ONE budgeted line out of seven read "forecast to finish 97% under
   * contract value". calculateJobWip sums estimated cost as
   * `?? 0`, so six unbudgeted lines contributed no forecast cost while
   * their contract value still counted — which makes any
   * partly-estimated job look spectacularly profitable.
   *
   * A number that flatters you for not having estimated is worse than no
   * number.
   */
  estimatedCoverage: number;
}): { tone: "over" | "watch" | "fine" | "unknown"; sentence: string } {
  const variance = jobCostVariance(job.wip);
  if (variance === null) {
    return {
      tone: "unknown",
      sentence: "No cost estimate yet, so there is nothing to compare against.",
    };
  }

  if (job.estimatedCoverage < MIN_ESTIMATE_COVERAGE) {
    return {
      tone: "unknown",
      sentence: `Only ${Math.round(job.estimatedCoverage * 100)}% of this job's value has a cost estimate, so a forecast would flatter it. Budget the rest to see where it lands.`,
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
