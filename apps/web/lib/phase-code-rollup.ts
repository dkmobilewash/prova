// Budget versus actual PER PHASE CODE, ACROSS EVERY JOB — the arithmetic
// half. Pure, so it can be tested with hand-written numbers; the half that
// turns Prisma rows into these inputs is lib/phase-code-rollup-query.ts.
// Same split as lib/alerts.ts / lib/alerts-query.ts and lib/bid-pipeline.ts
// / lib/bid-pipeline-query.ts, for the reason bid-pipeline-query.ts gives:
// the deciding is testable with hand-written inputs, and the row-reading
// half is where a Decimal or a null silently becomes the wrong thing.
//
import { laborCostForRows, type CostEntryCostRow, type DecimalLike, type TimeEntryCostRow } from "./labor-job-cost";
import type { FringeRateScheduleInput } from "./labor-cost";

// THE ONE THING THIS FILE EXISTS TO GET RIGHT: a line item with no phase
// code is reported, out loud, as its own row. Most lines have
// `phaseCodeId = null` — there is no backfill and the schema comment says
// there never will be, because inferring a phase from a free-text
// description is the guess the column was added to replace. A rollup that
// silently dropped those would tell a contractor their coded total is the
// whole picture, and it is not. Every figure here is derived at read time
// and stored nowhere.

/** One JobLineItem, flattened. */
export interface PhaseCodeRollupLine {
  /** Null means nobody has coded this line. Not an error, not a gap to
   * fill in with a guess — a fact about the line, and the reason the
   * uncoded row below exists. */
  phaseCodeId: string | null;
  /** Which job it sits on, so a phase can report how many jobs it appears
   * on rather than how many lines. */
  jobId: string;
  /** quantity × budgetedUnitCost, or null when no budgeted unit cost was
   * ever entered. Null and zero are different: null is "nobody has
   * budgeted this", zero is "budgeted at nothing". */
  budgetedCost: number | null;
  /** Everything booked against this line: SUM(CostEntry.amount) PLUS the
   * burdened labor on the TimeEntry rows that name it. Always a number: no
   * cost at all is zero spend, which is a fact rather than an absence.
   *
   * It was cost entries alone until #287 reached this file, which on a
   * self-performed line meant the materials and none of the crew — and a
   * cost code exists precisely to be compared against a labor budget. */
  actualCost: number;
  /** Hours booked to this line that NO wage schedule could price, so they
   * contributed zero dollars to `actualCost` above.
   *
   * Carried rather than folded in, because there is nothing to fold: the
   * missing dollars are exactly what nobody can compute. Without this the
   * page cannot tell a genuine underrun from hours nobody had a rate for,
   * and `PhaseCode.tracksLabor` makes that the likeliest misreading here. */
  unpricedLaborHours: number;
}

/**
 * One Prisma `JobLineItem` row, converted into the line above — including
 * its labor.
 *
 * THE ROW-READING HALF NORMALLY LIVES IN lib/phase-code-rollup-query.ts, and
 * this is the deliberate exception. The labor composition is the part of
 * that conversion that was WRONG for two days after #287 was called fixed,
 * and a query file cannot be unit-tested without a database — so the one
 * step with a history of being silently wrong sits here, where a test can
 * reach it, and the query file keeps only the Prisma call and the two
 * Decimal conversions whose failure modes it documents.
 *
 * `timeEntries` is the line's OWN entries, via the back-relation.
 */
export function phaseCodeRollupLine(
  row: {
    phaseCodeId: string | null;
    jobId: string;
    quantity: DecimalLike;
    budgetedUnitCost: DecimalLike | null;
    costEntries: readonly CostEntryCostRow[];
    timeEntries: readonly TimeEntryCostRow[];
  },
  schedulesByCraft: ReadonlyMap<string, FringeRateScheduleInput[]>,
): PhaseCodeRollupLine {
  const labor = laborCostForRows(row.timeEntries, schedulesByCraft);
  const manualCost = row.costEntries.reduce((sum, entry) => sum + Number(entry.amount), 0);
  return {
    phaseCodeId: row.phaseCodeId,
    jobId: row.jobId,
    budgetedCost:
      row.budgetedUnitCost === null ? null : Number(row.quantity) * Number(row.budgetedUnitCost),
    actualCost: manualCost + labor.total,
    unpricedLaborHours: labor.unpricedHours,
  };
}

/** A phase code as the company wrote it. Free text, deliberately not
 * validated against MasterFormat — see the model comment. */
export interface PhaseCodeMeta {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  tracksLabor: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface PhaseCodeRollupRow {
  /** Null on the uncoded row, and the only thing that distinguishes it. */
  phase: PhaseCodeMeta | null;
  budgetedCost: number;
  actualCost: number;
  /** budgetedCost − actualCost. Positive is under budget, negative is
   * over. Named rather than signed-by-convention because "variance" means
   * both directions in different trades' reports. */
  variance: number;
  /** Distinct jobs this phase appears on — the number that makes a
   * cross-job rollup worth having at all. */
  jobCount: number;
  lineCount: number;
  /** Lines carrying no budgeted unit cost. `budgetedCost` above is
   * understated by however much those lines would have added, and this is
   * the number that says so instead of letting the total look complete. */
  linesWithoutBudget: number;
  /** Hours in this row with no wage rate behind them. `actualCost` above is
   * understated by whatever they would have cost — the same shape of caveat
   * as `linesWithoutBudget`, on the other column. */
  unpricedLaborHours: number;
}

export interface PhaseCodeRollup {
  /** The company's own phase codes, in their own reading order. */
  rows: PhaseCodeRollupRow[];
  /** Work nobody has coded. ALWAYS present, even when it is empty — a row
   * that disappears when it reaches zero is a row nobody can trust when it
   * is non-zero, because its absence and its non-existence look the same. */
  uncoded: PhaseCodeRollupRow;
  /** Coded and uncoded together: the company's whole book of budgeted and
   * actual cost, so the reader can check the parts against the whole. */
  totals: {
    budgetedCost: number;
    actualCost: number;
    variance: number;
    lineCount: number;
    jobCount: number;
    /** Company-wide hours with no wage rate behind them — the one figure
     * that says whether every variance on this page is qualified. */
    unpricedLaborHours: number;
  };
  /** Share of BUDGETED cost that is coded to a phase, 0..1 — the honest
   * companion to every figure above, in the same shape `lib/wip.ts` uses
   * for `costCoverage`. 1 when there is no budgeted cost at all: nothing
   * budgeted means nothing uncoded. */
  budgetCoverage: number;
  /** The same question asked of money actually spent. Kept separate
   * because the two genuinely disagree — a company can code its budget
   * carefully and book cost against uncoded lines. */
  actualCoverage: number;
}

interface Bucket {
  budgetedCost: number;
  actualCost: number;
  lineCount: number;
  linesWithoutBudget: number;
  unpricedLaborHours: number;
  jobIds: Set<string>;
}

function emptyBucket(): Bucket {
  return {
    budgetedCost: 0,
    actualCost: 0,
    lineCount: 0,
    linesWithoutBudget: 0,
    unpricedLaborHours: 0,
    jobIds: new Set<string>(),
  };
}

function add(bucket: Bucket, line: PhaseCodeRollupLine) {
  bucket.lineCount += 1;
  bucket.jobIds.add(line.jobId);
  bucket.actualCost += line.actualCost;
  bucket.unpricedLaborHours += line.unpricedLaborHours;
  if (line.budgetedCost === null) bucket.linesWithoutBudget += 1;
  else bucket.budgetedCost += line.budgetedCost;
}

function row(phase: PhaseCodeMeta | null, bucket: Bucket): PhaseCodeRollupRow {
  return {
    phase,
    budgetedCost: bucket.budgetedCost,
    actualCost: bucket.actualCost,
    variance: bucket.budgetedCost - bucket.actualCost,
    jobCount: bucket.jobIds.size,
    lineCount: bucket.lineCount,
    linesWithoutBudget: bucket.linesWithoutBudget,
    unpricedLaborHours: bucket.unpricedLaborHours,
  };
}

/** The company's reading order, which is neither alphabetical nor code
 * order — that is what `sortOrder` is for. Code breaks the tie so two
 * phases sharing a sort order still render in a stable order rather than
 * whatever the database happened to return. */
function inReadingOrder(a: PhaseCodeMeta, b: PhaseCodeMeta): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.code.localeCompare(b.code);
}

/**
 * Budget, actual, variance and job count per phase code, plus the uncoded
 * row and the coverage that says how much of the picture the coded rows
 * are.
 *
 * WHICH PHASES GET A ROW, and it is a decision rather than a filter: every
 * ACTIVE phase, whether or not any work is coded to it, plus every RETIRED
 * phase that still has work coded to it. An active phase with no work is a
 * real, empty budget line and hiding it would make this page disagree with
 * the list on /settings. A retired phase with history is evidence of how
 * that work was coded and must keep reporting it — which is the whole
 * reason retiring is `isActive = false` and not a delete. A retired phase
 * with no history is the only one that is simply gone.
 *
 * A line whose `phaseCodeId` names a phase that is not in `phases` — which
 * the database's foreign key makes impossible within one company, and
 * which a cross-company mix-up would produce — is counted as UNCODED
 * rather than dropped. Dropping it would lose money out of the totals
 * silently; filing it under a phase we cannot name would be the guess this
 * feature refuses to make.
 */
export function rollUpPhaseCodes(
  phases: PhaseCodeMeta[],
  lines: PhaseCodeRollupLine[],
): PhaseCodeRollup {
  const known = new Map(phases.map((phase) => [phase.id, phase]));
  const buckets = new Map<string, Bucket>();
  const uncoded = emptyBucket();
  const totals = emptyBucket();

  for (const line of lines) {
    add(totals, line);
    const phase = line.phaseCodeId === null ? null : (known.get(line.phaseCodeId) ?? null);
    if (phase === null) {
      add(uncoded, line);
      continue;
    }
    let bucket = buckets.get(phase.id);
    if (!bucket) {
      bucket = emptyBucket();
      buckets.set(phase.id, bucket);
    }
    add(bucket, line);
  }

  const rows = [...phases]
    .sort(inReadingOrder)
    .filter((phase) => phase.isActive || buckets.has(phase.id))
    .map((phase) => row(phase, buckets.get(phase.id) ?? emptyBucket()));

  const codedBudget = totals.budgetedCost - uncoded.budgetedCost;
  const codedActual = totals.actualCost - uncoded.actualCost;

  return {
    rows,
    uncoded: row(null, uncoded),
    totals: {
      budgetedCost: totals.budgetedCost,
      actualCost: totals.actualCost,
      variance: totals.budgetedCost - totals.actualCost,
      unpricedLaborHours: totals.unpricedLaborHours,
      lineCount: totals.lineCount,
      jobCount: totals.jobIds.size,
    },
    budgetCoverage: totals.budgetedCost > 0 ? codedBudget / totals.budgetedCost : 1,
    actualCoverage: totals.actualCost > 0 ? codedActual / totals.actualCost : 1,
  };
}
