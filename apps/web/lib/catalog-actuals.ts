/**
 * How work priced from a catalog entry actually costed.
 *
 * `LineItemCatalogEntry.defaultBudgetedUnitCost` is set once — typed in, or
 * copied off a JobLineItem via "save as catalog item" — and then never
 * learns anything. Every job that used it produces real CostEntry rows
 * sitting one table away, and nothing ever reads them back. This closes that
 * loop: what the template says a unit costs, against what it has actually
 * cost across every line created from it.
 *
 * Reporting only. Nothing here writes; the catalog default changes only when
 * a human clicks to update it, and even then only the template moves — never
 * a JobLineItem that already exists.
 */

import {
  laborCostForRows,
  type CostEntryCostRow,
  type DecimalLike,
  type TimeEntryCostRow,
} from "./labor-job-cost";
import type { FringeRateScheduleInput } from "./labor-cost";

/** A line created from a catalog entry, with the costs logged against it. */
export type CatalogSourcedLine = {
  quantity: number;
  /**
   * SUM of this line's CostEntry amounts — every category, including a
   * manually typed LABOR one.
   *
   * NOT the line's cost. A CostEntry comes from exactly one place in the
   * product, the manual "log a cost" form, so on a self-performed line this
   * is the board and the screws and nothing else. The crew's time is
   * `laborCost` beside it, and both are added. Named for what it holds
   * rather than `actualCost`, which is what it was called while it was
   * quietly missing most of the money (#287).
   */
  costEntryTotal: number;
  /** How many CostEntry rows there are. A count rather than a boolean
   * because "costed" is no longer a question about cost entries alone — see
   * `hasAnyCost` below, which is derived here rather than by each caller so
   * that two callers cannot answer it differently. */
  costEntryCount: number;
  /**
   * Burdened labor booked to THIS line — base wage plus fringes over the
   * TimeEntry rows that name it, from lib/labor-job-cost.ts, which is the
   * same arithmetic /jobs/[id] and the WH-347 use.
   *
   * Only hours a FringeRateSchedule could price are in here; see
   * `unpricedLaborHours`.
   */
  laborCost: number;
  /** Every hour booked to this line, priced or not. Part of deciding whether
   * the line has been costed at all: a self-performed line commonly has no
   * CostEntry rows whatsoever. */
  laborHours: number;
  /**
   * Hours booked to this line that NO wage schedule could price.
   *
   * `calculateTimeEntryLaborCost` returns null rather than guessing a rate
   * when no FringeRateSchedule covers an entry's craft and date. Those hours
   * contribute zero dollars, and zero dollars is indistinguishable from
   * "cheap" inside a total — so a line carrying any of them is excluded from
   * the sample entirely rather than averaged in understated. Same treatment,
   * and the same reasoning, as an unfinished job below.
   */
  unpricedLaborHours: number;
  /**
   * Status of the job this line sits on.
   *
   * Load-bearing, not decoration — see FINISHED_JOB_STATUSES below. Cost
   * lands on a line over the months the work takes; quantity is the whole
   * scope from day one. Dividing one by the other before the work is done
   * does not produce a unit cost, it produces a fraction of one.
   */
  jobStatus: JobStatusForActuals;
};

export type JobStatusForActuals = "ESTIMATE" | "CONTRACTED" | "IN_PROGRESS" | "COMPLETE";

/**
 * The only status whose costs are finished arriving.
 *
 * This is the whole of the fix for #105 finding 2, a defect that was
 * quietly one-directional: a line 40% built at a true $2.00/SF had 40% of
 * its cost booked against 100% of its quantity, so it reported $0.80 —
 * 60% under, amber, "worth re-pricing", and one click away from becoming
 * the default that prices every future bid and grounds the AI drafts.
 * Every unfinished job biases the same way (down), so the errors reinforce
 * instead of cancelling, and repeatedly re-pricing walks the catalog's own
 * numbers toward zero.
 *
 * A partially-costed COMPLETE job is a different thing and stays in: the
 * work is actually done, so what it cost is what it cost.
 */
export const FINISHED_JOB_STATUSES: readonly JobStatusForActuals[] = ["COMPLETE"];

export function isFinishedForActuals(line: CatalogSourcedLine): boolean {
  return FINISHED_JOB_STATUSES.includes(line.jobStatus);
}

/**
 * Whether anything at all has been booked against this line.
 *
 * Derived here rather than handed in as a `hasCosts` boolean, because the
 * answer changed with #287 and a caller that still answered it the old way
 * (cost entries only) would silently drop every self-performed line out of
 * the sample — the jobs whose costs this loop most needs to learn from.
 */
export function hasAnyCost(line: CatalogSourcedLine): boolean {
  return line.costEntryCount > 0 || line.laborHours > 0;
}

/** Whether every hour on this line could be priced. A line with hours no
 * wage schedule covers is evidence of nothing: its labor reads as $0. */
export function isFullyPriced(line: CatalogSourcedLine): boolean {
  return line.unpricedLaborHours === 0;
}

/** Everything booked against the line: manual cost entries plus the crew's
 * burdened time. ADDED, never substituted — a company that logs hours AND
 * types a manual "labor" cost entry double-counts, and that is correct here:
 * this cannot tell a duplicate from two real costs, and dropping one would
 * make a cost somebody entered disappear. Same rule as `lineItemCostToDate`
 * in lib/labor-job-cost.ts, deliberately. */
export function lineTotalCost(line: CatalogSourcedLine): number {
  return line.costEntryTotal + line.laborCost;
}

export type CatalogActuals = {
  /** Costed lines on FINISHED jobs — the sample size, and the only lines any
   * figure below is computed from. */
  linesWithCosts: number;
  /**
   * Costed lines left out because their job is still running.
   *
   * Reported rather than silently dropped: "no costed job has used this
   * entry yet" and "three jobs have used it and none has finished" are
   * different situations, and an estimator who can't tell them apart will
   * read a missing figure as a missing feature rather than as "come back
   * once one of these finishes."
   */
  linesExcludedUnfinished: number;
  /**
   * Costed lines on FINISHED jobs left out because some of their hours have
   * no wage rate.
   *
   * Reported for the same reason `linesExcludedUnfinished` is: the estimator
   * needs to know the sample is smaller than the job history suggests, and
   * the two call for completely different actions. "Come back when a job
   * finishes" is waiting; this one is "add a fringe rate schedule for that
   * craft" and is fixable this afternoon.
   */
  linesExcludedUnpricedHours: number;
  /** Total cost across those lines, over total quantity. Null when nothing
   * has been costed, or when the quantities sum to zero. */
  actualUnitCost: number | null;
  /** The burdened labor inside the figure above, in dollars. Reported so the
   * screen can say the unit cost is mostly crew time rather than leaving an
   * estimator to wonder where the number came from. */
  laborCost: number;
  /** The manually logged cost entries inside the figure above. */
  costEntryTotal: number;
  defaultBudgetedUnitCost: number | null;
  /** actual - default, in dollars per unit. Null unless both exist. */
  variance: number | null;
  /** Variance as a fraction of the default (0.2 = 20% over). Null unless
   * both exist and the default is non-zero. */
  variancePct: number | null;
  /** True when the entry is priced far enough off actuals to be worth a
   * look. Never true on a single line — one job is an anecdote. */
  isFlagged: boolean;
};

/**
 * How far off a default has to be before it's worth flagging.
 *
 * Estimating is not supposed to be exact, and a catalog default that is
 * within a few percent of actuals is doing its job. Flagging those would
 * train people to ignore the flag, which costs more than the drift does.
 */
export const CATALOG_VARIANCE_THRESHOLD = 0.15;

/**
 * At least this many costed lines before flagging. One job that went badly
 * is not evidence the template is wrong, and re-pricing the catalog off a
 * single bad job propagates that job's problem into every future bid.
 */
export const CATALOG_MIN_SAMPLE = 2;

/**
 * A `JobLineItem` as this loop needs to read it, straight off Prisma.
 *
 * `timeEntries` is the line's OWN entries, via the back-relation — not the
 * whole job's. A catalog entry's lines are scattered across many jobs, so
 * fetching each entire job to throw most of it away would be a query shape
 * rather than a saving. (`lineItemCostToDate`, which serves the WIP surfaces,
 * takes the job's whole list because those callers already hold it.)
 */
export interface CatalogLineRow {
  quantity: DecimalLike;
  costEntries: readonly CostEntryCostRow[];
  timeEntries: readonly TimeEntryCostRow[];
  job: { status: string };
}

/**
 * One Prisma row, converted for `catalogActuals` — including its labor.
 *
 * THE POINT OF THIS FUNCTION IS THAT THERE IS ONLY ONE OF IT. The catalog
 * page renders this figure and `updateCatalogDefaultsFromActuals` WRITES it
 * into the entry's default. Those two building the same line differently is
 * how a badge comes to disagree with what the button beneath it saves, and
 * the write is the one that prices the next bid.
 */
export function catalogSourcedLine(
  row: CatalogLineRow,
  schedulesByCraft: ReadonlyMap<string, FringeRateScheduleInput[]>,
): CatalogSourcedLine {
  const labor = laborCostForRows(row.timeEntries, schedulesByCraft);
  return {
    quantity: Number(row.quantity),
    costEntryTotal: row.costEntries.reduce((sum, cost) => sum + Number(cost.amount), 0),
    costEntryCount: row.costEntries.length,
    laborCost: labor.total,
    laborHours: labor.pricedHours + labor.unpricedHours,
    unpricedLaborHours: labor.unpricedHours,
    // #105 finding 2: only a FINISHED job's booked cost is a real unit cost —
    // a job that is still running has quantity from day one but only partial
    // cost, which reads artificially low every time.
    jobStatus: row.job.status as JobStatusForActuals,
  };
}

export function catalogActuals(
  lines: CatalogSourcedLine[],
  defaultBudgetedUnitCost: number | null,
): CatalogActuals {
  const costedAnywhere = lines.filter(hasAnyCost);
  // Finding 2: only a FINISHED job's cost is a real unit cost. Excluding the
  // rest here means every figure below — sample size, actual cost, variance,
  // the flag — is computed the same honest way whichever caller asks for it.
  const finished = costedAnywhere.filter(isFinishedForActuals);
  // #287: and only a line whose hours could all be PRICED. An unfinished job
  // and unpriced hours are filtered in that order, and reported as two
  // separate counts, so a line that is both is named once rather than twice.
  const costed = finished.filter(isFullyPriced);
  const totalQuantity = costed.reduce((sum, line) => sum + line.quantity, 0);
  const totalCost = costed.reduce((sum, line) => sum + lineTotalCost(line), 0);
  const laborCost = costed.reduce((sum, line) => sum + line.laborCost, 0);
  const costEntryTotal = costed.reduce((sum, line) => sum + line.costEntryTotal, 0);

  // Weighted by quantity rather than averaging each line's own unit cost: a
  // 500 SF line and a 5 SF line are not equal evidence of what a square foot
  // costs, and averaging the per-line rates would treat them as if they were.
  const actualUnitCost = costed.length > 0 && totalQuantity > 0 ? totalCost / totalQuantity : null;

  const bothKnown = actualUnitCost !== null && defaultBudgetedUnitCost !== null;
  const variance = bothKnown ? actualUnitCost - defaultBudgetedUnitCost : null;
  const variancePct =
    bothKnown && defaultBudgetedUnitCost !== 0 ? variance! / defaultBudgetedUnitCost : null;

  return {
    linesWithCosts: costed.length,
    linesExcludedUnfinished: costedAnywhere.length - finished.length,
    linesExcludedUnpricedHours: finished.length - costed.length,
    actualUnitCost,
    laborCost,
    costEntryTotal,
    defaultBudgetedUnitCost,
    variance,
    variancePct,
    isFlagged:
      variancePct !== null &&
      costed.length >= CATALOG_MIN_SAMPLE &&
      Math.abs(variancePct) >= CATALOG_VARIANCE_THRESHOLD,
  };
}

/** What "update default from actuals" would write, or why it refuses to. */
export type RepriceDecision =
  | { ok: false; error: string }
  | {
      ok: true;
      /** The new default budgeted cost, as a decimal string ready for Prisma. */
      defaultBudgetedUnitCost: string;
      /** The new default sale price — present only when asked for AND there
       * was a margin to hold. */
      defaultUnitPrice?: string;
    };

/**
 * The whole of the re-price decision, as a pure function of the actuals.
 *
 * This is finding 3's fix, and the fix is visible in the SIGNATURE: there is
 * nowhere here for a number the browser sent to come in. `updateCatalogDefaultsFromActuals`
 * used to take `actualUnitCost` from a hidden input and write it after
 * checking only that it parsed — for the one control in the app that edits a
 * price every future bid and every AI draft reads. `importCatalogEntries` in
 * the same file already refused exactly that pattern for a pasted price
 * list; this is the same discipline applied to the other write path. Every
 * number returned here is derived from `actuals`, which is itself derived
 * from the job line items — never from the request.
 *
 * It also re-checks the conditions the page rendered the button behind,
 * rather than trusting them: the page may be minutes old, and a costed line
 * landing since (finding 2's fix) can move an entry back inside the
 * threshold or make it eligible for the first time.
 *
 * The only thing the request still decides is the boolean: whether to also
 * move the sale price. That is a margin call belonging to the estimator, not
 * a fact the jobs measured — "our cost went up 20%" must not silently become
 * "we now charge 20% more".
 */
export function repriceDecision(
  actuals: CatalogActuals,
  currentDefaultUnitPrice: number | null,
  alsoUpdatePrice: boolean,
): RepriceDecision {
  if (actuals.actualUnitCost === null) {
    const unfinished = actuals.linesExcludedUnfinished;
    const unpriced = actuals.linesExcludedUnpricedHours;

    // Unpriced hours are named FIRST when both apply, because they are the
    // only one of the two the reader can act on today. "No finished job has
    // used this entry" sends an estimator looking for jobs; the actual fix
    // here is a fringe rate schedule for the craft that worked those hours.
    if (unpriced > 0) {
      return {
        ok: false,
        error: `Nothing to re-price from: ${unpriced} finished ${
          unpriced === 1 ? "line has hours" : "lines have hours"
        } with no wage rate behind them, so what the work cost isn't known. Add a fringe rate schedule covering the craft and dates those hours were worked, then try again.`,
      };
    }

    return {
      ok: false,
      error:
        unfinished > 0
          ? `Nothing to re-price from: this entry has ${unfinished} costed ${
              unfinished === 1 ? "line" : "lines"
            }, but ${unfinished === 1 ? "its job hasn't" : "none of those jobs have"} finished yet, so the cost booked so far isn't a unit cost.`
          : "Nothing to re-price from — no finished job has used this entry yet.",
    };
  }

  if (!actuals.isFlagged) {
    return {
      ok: false,
      error:
        "This entry's default is no longer far enough from actuals to be worth changing — reload the page to see the current figures.",
    };
  }

  const defaultBudgetedUnitCost = actuals.actualUnitCost.toFixed(2);
  if (!alsoUpdatePrice) return { ok: true, defaultBudgetedUnitCost };

  // Hold the existing margin over the new cost, so the price moves by the
  // same proportion rather than collapsing to cost. With no prior price
  // there is no margin to preserve, and inventing one would be a pricing
  // decision this has no business making — the cost still updates and the
  // price is left alone.
  //
  // The null/zero prior-cost arm is a backstop rather than a live branch:
  // isFlagged already requires a variancePct, which requires a prior cost
  // that is neither null nor zero, so a flagged entry always has one here.
  // Kept so that loosening isFlagged later cannot silently divide by zero
  // and write an infinite sale price.
  const oldCost = actuals.defaultBudgetedUnitCost;
  if (oldCost === null || oldCost <= 0 || currentDefaultUnitPrice === null) {
    return { ok: true, defaultBudgetedUnitCost };
  }

  return {
    ok: true,
    defaultBudgetedUnitCost,
    defaultUnitPrice: ((currentDefaultUnitPrice / oldCost) * Number(defaultBudgetedUnitCost)).toFixed(2),
  };
}
