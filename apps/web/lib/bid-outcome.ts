/**
 * What a job was BID at, beside what it actually COST.
 *
 * This is the loop the app has never been able to close. `estimating.prisma`
 * said so itself until today — "linking a won BidInvitation forward to its Job
 * is a future refinement, not built here" — and without that link every
 * feedback mechanism in the product was narrower than the question an
 * estimator actually asks. `catalog-actuals.ts` answers it per catalog entry.
 * `phase-code-rollup.ts` answers it per phase code. `bid-pipeline.ts` answers
 * win rate. None of them answers "did we bid this job right".
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE RULE THIS MODULE IS BUILT AROUND: A VERDICT ON AN UNFINISHED JOB IS
 * NOT A VERDICT.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * A job three weeks in has spent 20% of its cost and earned none of its
 * lessons. Reporting "you bid this 40% over" from that is worse than
 * reporting nothing, because it is a real-looking number that will be
 * remembered and repeated. So the comparison has three states and says which
 * one it is in, every time:
 *
 *   PENDING    — the job is still running. Cost to date is reported AS cost to
 *                date, with the percent complete beside it, and the word
 *                margin does not appear.
 *   SETTLED    — the job is complete. Now the numbers mean what they look
 *                like, and the variance is stated.
 *   UNKNOWABLE — something needed is missing (no bid amount, no costs yet,
 *                no forecast to derive completion from). Named, not guessed.
 *
 * COST COMES FROM `calculateJobWip`, NEVER FROM A SECOND SUM. Whatever this
 * app means by "what this job has cost" is what the Job costing panel and the
 * WIP schedule already mean by it — one definition, three surfaces. A private
 * total here would drift from them within a month and nobody would know which
 * was right.
 *
 * Pure. No database, no React.
 */

/** Two decimals, the way every money figure in this app reads. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

export type BidOutcomeState = "PENDING" | "SETTLED" | "UNKNOWABLE";

export type BidOutcomeInput = {
  /** What was bid, as recorded on the invitation. Null when the bid was won
   * without an amount ever being entered — common, and worth saying. */
  bidAmount: number | null;
  /** The job's status, which is what decides whether a verdict is possible. */
  jobStatus: string;
  /** From `calculateJobWip` — the app's one definition of these. */
  contractValue: number;
  actualCostToDate: number;
  percentComplete: number | null;
};

export type BidOutcome = {
  state: BidOutcomeState;
  /** Why there is no verdict, in the words the screen shows. Null when
   * `state` is SETTLED. */
  because: string | null;
  bidAmount: number | null;
  contractValue: number;
  actualCostToDate: number;
  percentComplete: number | null;
  /** Contract minus bid: did the job end up sold for what it was bid at?
   * Null without a bid amount. Change orders live in here, which is why it is
   * reported separately from cost rather than folded into one "variance". */
  contractVsBid: number | null;
  /** Cost against the BID — the number the estimator is actually asking for.
   * Only meaningful once SETTLED, and null otherwise BY CONSTRUCTION rather
   * than by the caller remembering not to show it. */
  costVsBid: number | null;
  /** The same as a fraction of the bid: 0.08 means the job cost 8% more than
   * it was bid at. Null unless SETTLED. */
  costVsBidPercent: number | null;
};

/** A job is finished, for this purpose, when the app says it is. Deliberately
 * NOT "percent complete >= 1": that figure is derived from cost forecasts an
 * estimator may never have filled in, and a job can read 100% while work
 * continues. The status is a person's statement; the percentage is an
 * inference. */
const FINISHED = new Set(["COMPLETE"]);

export function bidOutcome(input: BidOutcomeInput): BidOutcome {
  const { bidAmount, jobStatus, contractValue, actualCostToDate, percentComplete } = input;

  const base = {
    bidAmount,
    contractValue: round2(contractValue),
    actualCostToDate: round2(actualCostToDate),
    percentComplete,
    contractVsBid: bidAmount === null ? null : round2(contractValue - bidAmount),
    costVsBid: null,
    costVsBidPercent: null,
  };

  if (bidAmount === null) {
    return {
      ...base,
      state: "UNKNOWABLE",
      because: "This bid has no amount recorded, so there is nothing to compare the job's cost against.",
    };
  }
  if (bidAmount <= 0) {
    return {
      ...base,
      state: "UNKNOWABLE",
      because: "This bid was recorded as zero, which cannot be compared against anything.",
    };
  }

  if (!FINISHED.has(jobStatus)) {
    const soFar =
      percentComplete === null
        ? "how far along it is cannot be worked out yet — no line has a cost forecast"
        : `it is about ${Math.round(percentComplete * 100)}% complete by cost`;
    return {
      ...base,
      state: "PENDING",
      because: `This job is still running, so ${soFar}. What it cost against what it was bid is not a question that can be answered until it finishes.`,
    };
  }

  if (actualCostToDate <= 0) {
    return {
      ...base,
      state: "UNKNOWABLE",
      because: "This job is complete but has no costs recorded against it, so there is nothing to compare.",
    };
  }

  const costVsBid = round2(actualCostToDate - bidAmount);
  return {
    ...base,
    state: "SETTLED",
    because: null,
    costVsBid,
    costVsBidPercent: round2((costVsBid / bidAmount) * 100) / 100,
  };
}

/**
 * The one sentence that goes beside a settled bid.
 *
 * Says which direction and by how much, in the estimator's own terms — a job
 * that cost MORE than it was bid at is the expensive case and is named first.
 * Returns null for anything not settled: the caller shows `because` instead,
 * and cannot accidentally print a verdict.
 */
export function settledSentence(outcome: BidOutcome, money: (value: number) => string): string | null {
  if (outcome.state !== "SETTLED" || outcome.costVsBid === null || outcome.costVsBidPercent === null) {
    return null;
  }
  const pct = Math.abs(outcome.costVsBidPercent * 100);
  // A decimal place only where it carries information. "8.0% over" reads as
  // false precision; "1.2% over" would round away to "1%" without it.
  const rounded = Math.abs(pct - Math.round(pct)) < 0.05 ? String(Math.round(pct)) : pct.toFixed(1);
  if (outcome.costVsBid > 0) {
    return `Cost ${money(outcome.costVsBid)} more than it was bid at — ${rounded}% over.`;
  }
  if (outcome.costVsBid < 0) {
    return `Cost ${money(Math.abs(outcome.costVsBid))} less than it was bid at — ${rounded}% under.`;
  }
  return "Cost exactly what it was bid at.";
}

/**
 * Across several settled bids: how this company's bids have run against what
 * the work actually cost.
 *
 * UNSETTLED BIDS ARE EXCLUDED, not counted as zero, and the count of what was
 * excluded is returned so the screen can say so. A rate computed over "every
 * bid, treating the unfinished ones as on-budget" is the shape of answer that
 * reads fine and is wrong — the same defect as counting a dead verify agent as
 * a refutation (CLAUDE.md).
 */
export type BidRecord = {
  settled: number;
  /** Bids linked to a job that has not settled yet, or that cannot be read. */
  notYet: number;
  /** Mean of `costVsBidPercent` over settled bids, or null when none. */
  averageVariance: number | null;
  /** How many settled bids came in over what they were bid at. */
  over: number;
  under: number;
};

export function bidRecord(outcomes: BidOutcome[]): BidRecord {
  const settled = outcomes.filter(
    (o): o is BidOutcome & { costVsBidPercent: number } =>
      o.state === "SETTLED" && o.costVsBidPercent !== null,
  );
  if (settled.length === 0) {
    return { settled: 0, notYet: outcomes.length, averageVariance: null, over: 0, under: 0 };
  }
  const total = settled.reduce((sum, o) => sum + o.costVsBidPercent, 0);
  return {
    settled: settled.length,
    notYet: outcomes.length - settled.length,
    averageVariance: round2((total / settled.length) * 100) / 100,
    over: settled.filter((o) => o.costVsBidPercent > 0).length,
    under: settled.filter((o) => o.costVsBidPercent < 0).length,
  };
}
