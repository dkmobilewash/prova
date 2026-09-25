/**
 * Pricing a job before there is anything to measure.
 *
 * Somebody hears about a 40,000 SF office TI. There are no drawings, no
 * takeoff and no line items, and they have to decide within the day whether
 * to chase it. Today `BidPursuit.estimatedValue` takes a number typed in from
 * nothing — "a rough value for our scope, when somebody has one" — and the
 * app offers no help producing it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THIS NEVER RETURNS A NUMBER. IT RETURNS A RANGE, A SAMPLE SIZE, OR NOTHING.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * A dollars-per-square-foot figure is the most dangerous kind of number this
 * product could produce: it looks exactly like a measured one, it is
 * arithmetically trivial, and it is wrong in ways nobody can see. Print
 * "$62,400" beside three real line-item totals and within a week somebody
 * will have sent it to a GC.
 *
 * So four rules, each of which is a test in the file beside this one:
 *
 *   1. A RANGE, never a point. Low, median and high from the company's own
 *      finished work. An estimator reading "$38–$71/SF" knows what they have;
 *      one reading "$54/SF" does not.
 *   2. THE SAMPLE SIZE IS ALWAYS RETURNED, and below `MINIMUM_SAMPLE` there
 *      is no range at all — just the reason. Two finished jobs cannot
 *      describe a market, and a rate derived from one is that one job
 *      wearing a disguise.
 *   3. IT COMES FROM THIS COMPANY'S HISTORY, not a typed-in rate and not a
 *      published index. The only figures here are what this contractor
 *      actually sold and actually spent.
 *   4. NOTHING HERE IS WRITTEN ANYWHERE. It is shown beside a field a person
 *      fills in themselves. There is no action that sets `estimatedValue`
 *      from this, deliberately — see the pursuit UI.
 *
 * WHAT IT IS NOT FOR, said plainly because the temptation is obvious: this
 * must never be summed with, compared against, or shown beside a line-item
 * estimate. A conceptual figure and an estimate built from quantities are
 * different kinds of claim, and a screen that puts them side by side invites
 * the reader to treat them as the same.
 *
 * Pure. No database, no React.
 */

/**
 * Three finished jobs. Not two, and the reason is not statistical rigour —
 * with three you can at least see a spread, and a spread is what stops a
 * single unusual job being read as a rate. Two jobs produce a "range" that is
 * just the two of them, and one produces a point masquerading as a range.
 *
 * It is deliberately low. A specialty sub may finish a dozen jobs a year, so
 * a floor of ten would mean the feature never works. Three plus a visible
 * sample size is the honest trade: useful early, and never pretending to more
 * than it has.
 */
export const MINIMUM_SAMPLE = 3;

/** One finished job that can contribute a rate. */
export type HistoricalJob = {
  jobId: string;
  jobName: string;
  /** The building's gross area. Rows without one are the caller's to filter,
   * but this module filters again rather than trusting that. */
  grossAreaSqFt: number | null;
  /** What the job sold for, from `calculateJobWip`'s `contractValue`. */
  contractValue: number;
  /** What it cost, from the same place. */
  actualCostToDate: number;
  /** Only SETTLED jobs count — see `bid-outcome.ts`. A job still running has
   * spent a fifth of its cost and earned none of its lessons. */
  settled: boolean;
};

export type Spread = {
  low: number;
  median: number;
  high: number;
};

export type Benchmark = {
  /** How many finished jobs are behind this. ALWAYS present, including when
   * it is too small to produce a range. */
  sampleSize: number;
  /** What similar work SOLD for, per square foot. Null below MINIMUM_SAMPLE. */
  sellPerSqFt: Spread | null;
  /** What it COST, per square foot. Null below MINIMUM_SAMPLE. */
  costPerSqFt: Spread | null;
  /** Why there is no range, in the words the screen shows. Null when there
   * is one. */
  because: string | null;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** The middle value, averaging the two middles on an even count. */
function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function spreadOf(values: number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    low: round2(sorted[0]),
    median: round2(median(sorted)),
    high: round2(sorted[sorted.length - 1]),
  };
}

/**
 * What this company's finished work says a square foot is worth.
 *
 * A job contributes only when it is SETTLED and carries a positive area. Both
 * filters are applied here rather than trusted from the query, because a
 * benchmark is the kind of figure that gets quoted long after anybody
 * remembers where it came from.
 */
export function benchmarkFromHistory(jobs: HistoricalJob[]): Benchmark {
  const usable = jobs.filter(
    (job) =>
      job.settled &&
      job.grossAreaSqFt !== null &&
      Number.isFinite(job.grossAreaSqFt) &&
      job.grossAreaSqFt > 0,
  );

  if (usable.length < MINIMUM_SAMPLE) {
    const withArea = usable.length;
    const settledWithoutArea = jobs.filter((job) => job.settled && !job.grossAreaSqFt).length;
    return {
      sampleSize: withArea,
      sellPerSqFt: null,
      costPerSqFt: null,
      because:
        withArea === 0
          ? settledWithoutArea > 0
            ? `No finished job has a gross area recorded yet. ${settledWithoutArea} ${settledWithoutArea === 1 ? "job is" : "jobs are"} finished but ${settledWithoutArea === 1 ? "has" : "have"} no area on ${settledWithoutArea === 1 ? "it" : "them"}, so there is nothing to compare a new project against.`
            : "No finished job has a gross area recorded yet, so there is nothing to compare a new project against."
          : `Only ${withArea} finished ${withArea === 1 ? "job carries" : "jobs carry"} a gross area. ${MINIMUM_SAMPLE} is the fewest that can show a spread rather than one job wearing a disguise.`,
    };
  }

  return {
    sampleSize: usable.length,
    sellPerSqFt: spreadOf(usable.map((job) => job.contractValue / (job.grossAreaSqFt as number))),
    costPerSqFt: spreadOf(usable.map((job) => job.actualCostToDate / (job.grossAreaSqFt as number))),
    because: null,
  };
}

export type ConceptualRange = {
  areaSqFt: number;
  /** Null whenever the benchmark has no range. By construction, so a caller
   * cannot render a figure that does not exist. */
  sell: Spread | null;
  cost: Spread | null;
  sampleSize: number;
  because: string | null;
};

/**
 * An area times the benchmark — as a range, with the sample size attached.
 *
 * Returns nulls rather than zeros when there is no benchmark, for the reason
 * `bid-outcome.ts` gives about unfinished jobs: a figure that does not exist
 * must be absent, not zero, so no screen can print it by forgetting to check.
 */
export function conceptualRange(areaSqFt: number, benchmark: Benchmark): ConceptualRange {
  const usableArea = Number.isFinite(areaSqFt) && areaSqFt > 0 ? areaSqFt : 0;

  if (usableArea === 0) {
    return {
      areaSqFt: 0,
      sell: null,
      cost: null,
      sampleSize: benchmark.sampleSize,
      because: "Enter the building's gross area to see what similar work has run at.",
    };
  }
  if (!benchmark.sellPerSqFt || !benchmark.costPerSqFt) {
    return {
      areaSqFt: usableArea,
      sell: null,
      cost: null,
      sampleSize: benchmark.sampleSize,
      because: benchmark.because,
    };
  }

  const scale = (spread: Spread): Spread => ({
    low: round2(spread.low * usableArea),
    median: round2(spread.median * usableArea),
    high: round2(spread.high * usableArea),
  });

  return {
    areaSqFt: usableArea,
    sell: scale(benchmark.sellPerSqFt),
    cost: scale(benchmark.costPerSqFt),
    sampleSize: benchmark.sampleSize,
    because: null,
  };
}

/**
 * The sentence above the figures.
 *
 * NEVER states a single number, and always says how many jobs are behind it.
 * The hedge is the feature: a reader who cannot see the sample size cannot
 * judge the range, and a range nobody can judge gets quoted as a price.
 */
export function conceptualSentence(
  range: ConceptualRange,
  money: (value: number) => string,
): string {
  if (!range.sell) return range.because ?? "Nothing to compare this against yet.";
  const n = range.sampleSize;
  return `From ${n} finished ${n === 1 ? "job" : "jobs"} of this company's own: ${money(range.sell.low)} to ${money(range.sell.high)}, middle ${money(range.sell.median)}. An order-of-magnitude figure from gross area — not an estimate, and not a price to send anybody.`;
}
