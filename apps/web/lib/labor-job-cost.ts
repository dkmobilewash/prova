// Logged hours as JOB COST -- the one place that turns a job's TimeEntry
// rows into the burdened dollars that feed actualCostToDate, and therefore
// percent complete, earned revenue, over/under billing, gross margin, the
// company metric bar and the WIP schedule a surety reads.
//
// WHY THIS FILE EXISTS (issue #287). Until it did, `actualCostToDate` was
// fed ONLY by `CostEntry` rows, and a CostEntry is created in exactly one
// place: the manual "log a cost" form. Nothing derived one from a TimeEntry.
// The app already computed each entry's burdened cost -- `calculateTimeEntryLaborCost`
// has been right the whole time, and /jobs/[id] printed it on the row -- and
// then added it to nothing. On a self-performed framing/drywall job labor is
// most of the cost, so every percentage above was computed over a fraction of
// the money, and no screen said so.
//
// IT DOES NOT WRITE ANYTHING. Derived state is never stored here (CLAUDE.md):
// materialising CostEntry rows from time entries would both store a derived
// figure and double-count against any manual labor cost somebody has already
// typed in. This is computed at read time, every time.
//
// IT DOES NOT INVENT A COSTING RULE. The wage math is
// `calculateTimeEntryLaborCost` and the schedule lookup is
// `findEffectiveFringeRateSchedule`, used exactly the way
// lib/certified-payroll.ts uses them, so a wage dollar on the job page and a
// wage dollar on a WH-347 come from the same arithmetic.
//
// WHAT IT ADDS THAT A WH-347 MUST NOT HAVE. The EMPLOYER'S share -- FICA,
// FUTA/SUTA, workers' comp -- as a percentage of base wages, at the
// EmployerBurdenRate in force on each entry's own day (lib/employer-burden.ts).
// That is job cost and it is not a wage: a certified payroll reports what the
// worker was paid, so the burden is added HERE and never inside
// `calculateTimeEntryLaborCost`. With no rate recorded it is zero and every
// figure below is exactly what it was before this file learned the word.

import {
  calculateTimeEntryBaseWage,
  calculateTimeEntryLaborCost,
  findEffectiveFringeRateSchedule,
  type FringeRateScheduleInput,
  type TimeEntryPayType,
} from "./labor-cost";
import {
  employerBurdenCents,
  employerBurdenPercentOn,
  type EmployerBurdenRateRecord,
} from "./employer-burden";
import { NO_LABOR_COST, type WipLaborCost } from "./wip";

/**
 * The company's recorded employer-burden rates, as every entry point here
 * takes them.
 *
 * AN EMPTY ARRAY IS THE DEFAULT AND MEANS "ADD NOTHING". Every parameter
 * below defaults to `NO_EMPLOYER_BURDEN`, so a caller that has not been
 * taught about burden gets EXACTLY the arithmetic it got before this existed
 * -- not an approximation of it, the same additions in the same order. That
 * is deliberate and it is the most important property of this change: these
 * figures have already been quoted to GCs, and a silent shift across every
 * existing job would be far worse than the understatement being fixed.
 *
 * Because the default is silent, `employerBurdenCensus.test.ts` is what
 * stops a job-cost surface quietly keeping it: a forgotten call site is a
 * screen disagreeing with the screen beside it, which is the #287 shape.
 */
export type EmployerBurdenRates = readonly EmployerBurdenRateRecord[];

/** No rate recorded. Named rather than written as `[]` at each call site so
 * that a surface which genuinely has no company behind it -- the landing
 * page's illustrative panel -- says so in words the census can read. */
export const NO_EMPLOYER_BURDEN: EmployerBurdenRates = [];

/**
 * PER DIEM AND TRAVEL PAY IN JOB COST -- THE FLIP.
 *
 * `TimeEntry.perDiemAmount` and `.travelPayAmount` are flat daily
 * allowances, already stored in dollars, so they need no fringe schedule and
 * are never "unpriced". They are real money the company pays to have the
 * work done, so they are IN job cost today.
 *
 * That is a judgment call the founder is still making, not a fact about
 * accounting, so it is one line with a name rather than a sum nobody can
 * find. Set this to false and allowances stop reaching `actualCostToDate`
 * at all three WIP surfaces at once -- they are still counted and still
 * reported separately as `laborAllowanceCost`, so nothing goes dark, the
 * number just stops being added in.
 *
 * Typed `boolean` rather than left to literal inference on purpose: the
 * other branch must stay compiled and type-checked, not become dead code
 * the moment someone flips it.
 */
export const LABOR_ALLOWANCES_IN_JOB_COST: boolean = true;

/** One logged day, in plain numbers. Deliberately not the Prisma row: this
 * half of the file is pure arithmetic and is tested without a database. */
export interface LaborCostTimeEntry {
  craftClassificationId: string | null;
  date: Date;
  hours: number;
  payType: TimeEntryPayType;
  perDiemAmount: number | null;
  travelPayAmount: number | null;
}

/**
 * Burdened labor over a set of time entries.
 *
 * `wageCost` and `allowanceCost` are separate components and not a single
 * sum, so the caveat on screen can say which is which and the flip above is
 * one line. `total` is what the flip decides.
 *
 * `unpricedHours` is the honest half. `calculateTimeEntryLaborCost` returns
 * null when no fringe schedule is effective for an entry's craft and date --
 * it refuses to guess a wage, deliberately, because a wrong burden gets bid.
 * Those hours contribute NO wage dollars, so without this field they would
 * read as $0 of labor, which is the same "a number that is wrong and looks
 * right" failure this whole file exists to end.
 *
 * An entry with unpriced hours can still contribute allowance dollars: a per
 * diem is a stored amount and does not need a rate.
 */
export function calculateBurdenedLaborCost(
  entries: readonly LaborCostTimeEntry[],
  schedulesByCraft: ReadonlyMap<string, FringeRateScheduleInput[]>,
  burdenRates: EmployerBurdenRates = NO_EMPLOYER_BURDEN,
): WipLaborCost {
  let wageCost = 0;
  let allowanceCost = 0;
  let pricedHours = 0;
  let unpricedHours = 0;
  // Base wages accumulated per percentage in force, so the burden is rounded
  // ONCE per rate at the end rather than once per time entry. A hundred
  // entries rounded individually is a hundred roundings, and the total then
  // disagrees with what an accountant gets by multiplying the payroll total.
  // Keyed by the percentage rather than by the rate row, so two rows that
  // happen to carry the same figure cannot round apart.
  const burdenBaseByPercent = new Map<number, number>();

  for (const entry of entries) {
    const schedules = entry.craftClassificationId
      ? (schedulesByCraft.get(entry.craftClassificationId) ?? [])
      : [];
    const schedule = findEffectiveFringeRateSchedule(schedules, entry.date);
    const cost = calculateTimeEntryLaborCost(
      { hours: entry.hours, payType: entry.payType, date: entry.date },
      schedule,
    );

    if (cost === null) {
      unpricedHours += entry.hours;
    } else {
      wageCost += cost;
      pricedHours += entry.hours;

      // The rate in force on THIS ENTRY'S day, not today's: hours worked in
      // March stay costed at March's burden after April's is recorded.
      const percent = employerBurdenPercentOn(burdenRates, entry.date);
      if (percent !== null && percent !== 0) {
        // BASE WAGE ONLY, never the fringes -- lib/employer-burden.ts says
        // why, and says that it is a modelling choice for a CPA rather than
        // a tax rule anybody verified. The base already carries the pay-type
        // multiplier, so an overtime hour's burden follows its overtime
        // dollars.
        const base = calculateTimeEntryBaseWage(
          { hours: entry.hours, payType: entry.payType, date: entry.date },
          schedule,
        );
        if (base !== null) {
          burdenBaseByPercent.set(percent, (burdenBaseByPercent.get(percent) ?? 0) + base);
        }
      }
    }

    allowanceCost += (entry.perDiemAmount ?? 0) + (entry.travelPayAmount ?? 0);
  }

  let burdenCents = 0;
  for (const [percent, base] of burdenBaseByPercent) {
    burdenCents += employerBurdenCents(base, percent);
  }
  const burdenCost = burdenCents / 100;

  // `wageCost + burdenCost` before the allowance, so that with no rate
  // recorded burdenCost is exactly 0, this is exactly `wageCost`, and the
  // total is the identical float sum this function returned before burden
  // existed. Pinned by employer-burden.test.ts rather than left to the
  // reader's confidence about IEEE 754.
  const wageAndBurden = wageCost + burdenCost;

  return {
    wageCost,
    burdenCost,
    allowanceCost,
    total: LABOR_ALLOWANCES_IN_JOB_COST ? wageAndBurden + allowanceCost : wageAndBurden,
    pricedHours,
    unpricedHours,
  };
}

// ---------------------------------------------------------------------------
// The Prisma-facing half: the same read, spelled the way the three WIP call
// sites actually have their rows. Still no Prisma import and still no query --
// these take rows a caller already fetched, so this file stays testable
// without a database.
// ---------------------------------------------------------------------------

/** What Prisma hands back for a Decimal column, or a plain number. The three
 * call sites all do `Number(...)` on these; doing it here instead is what
 * lets the job page's edit be one expression. */
export type DecimalLike = number | string | { toString(): string };

function num(value: DecimalLike | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A TimeEntry row as job costing needs it. `lineItemId` is NULLABLE and
 * that is not an edge case: `TimeEntryFields` offers "No specific line" as
 * the default option, so an unattached entry is the ordinary shape. See
 * `unassignedLaborCost` below for where those dollars go. */
export interface TimeEntryCostRow {
  lineItemId: string | null;
  craftClassificationId: string | null;
  date: Date;
  hours: DecimalLike;
  payType: TimeEntryPayType;
  perDiemAmount: DecimalLike | null;
  travelPayAmount: DecimalLike | null;
}

export interface CostEntryCostRow {
  amount: DecimalLike;
}

function toPlainEntry(row: TimeEntryCostRow): LaborCostTimeEntry {
  return {
    craftClassificationId: row.craftClassificationId,
    date: row.date,
    hours: num(row.hours),
    payType: row.payType,
    perDiemAmount: row.perDiemAmount == null ? null : num(row.perDiemAmount),
    travelPayAmount: row.travelPayAmount == null ? null : num(row.travelPayAmount),
  };
}

/** Exactly the fields of `WipLineItemInput` that describe money already
 * spent, so a call site can spread this into `calculateLineItemWip` without
 * restating any of them. */
export interface LineItemCostToDate {
  actualCostToDate: number;
  labor: WipLaborCost;
}

/**
 * One line item's cost to date: manual cost entries PLUS the burdened labor
 * on the time entries that name this line.
 *
 * ADDED, never substituted. A company that logs hours AND types a manual
 * "labor" cost entry will double-count, and that is the correct behaviour for
 * this function -- it cannot tell a duplicate from two real costs, and
 * silently dropping one would make a cost somebody entered disappear. The
 * split is on the result so a screen can show both.
 *
 * Takes the job's WHOLE time-entry list and filters, rather than a
 * pre-grouped map, so that /jobs/[id] -- a 2000-line file in another
 * person's lane -- needs one expression changed and nothing else.
 */
export function lineItemCostToDate(
  lineItemId: string,
  costEntries: readonly CostEntryCostRow[],
  jobTimeEntries: readonly TimeEntryCostRow[],
  schedulesByCraft: ReadonlyMap<string, FringeRateScheduleInput[]>,
  burdenRates: EmployerBurdenRates = NO_EMPLOYER_BURDEN,
): LineItemCostToDate {
  const manualCost = costEntries.reduce((sum, entry) => sum + num(entry.amount), 0);
  const labor = laborCostForRows(
    jobTimeEntries.filter((entry) => entry.lineItemId === lineItemId),
    schedulesByCraft,
    burdenRates,
  );
  return { actualCostToDate: manualCost + labor.total, labor };
}

/**
 * Burdened labor over TimeEntry ROWS a caller has already narrowed.
 *
 * The same arithmetic as everything above -- this is the entry point for a
 * caller whose query already scopes the entries, rather than one holding a
 * whole job's list to filter. /catalog and `updateCatalogDefaultsFromActuals`
 * read `JobLineItem.timeEntries` directly, because a catalog entry's lines
 * are scattered across many jobs and fetching each whole job to throw most of
 * it away would be a query shape, not a saving.
 *
 * It exists so that those two call sites cannot grow a SECOND costing rule.
 * Issue #287 was never bad arithmetic; it was correct arithmetic that nothing
 * called, and the way that recurs is a new surface writing its own sum.
 */
export function laborCostForRows(
  rows: readonly TimeEntryCostRow[],
  schedulesByCraft: ReadonlyMap<string, FringeRateScheduleInput[]>,
  burdenRates: EmployerBurdenRates = NO_EMPLOYER_BURDEN,
): WipLaborCost {
  if (rows.length === 0) return NO_LABOR_COST;
  return calculateBurdenedLaborCost(rows.map(toPlainEntry), schedulesByCraft, burdenRates);
}

/**
 * Burdened labor on the entries that name NO line item.
 *
 * This is the part the brief for #287 did not anticipate and it is not a
 * rounding error: the log-hours form's line-item select defaults to "No
 * specific line", so unattached entries are the common case rather than the
 * exception. Attaching labor only to lines would have left most of a job's
 * labor out of job cost while every screen looked fixed.
 *
 * It goes into the job's `actualCostToDate` and into no line's, which is
 * exactly what `costCoverage` already exists to report: the percentage is
 * computed over forecast LINES, so spend that belongs to no line correctly
 * drags that ratio down and the job page already prints it.
 */
export function unassignedLaborCost(
  jobTimeEntries: readonly TimeEntryCostRow[],
  schedulesByCraft: ReadonlyMap<string, FringeRateScheduleInput[]>,
  burdenRates: EmployerBurdenRates = NO_EMPLOYER_BURDEN,
): WipLaborCost {
  if (jobTimeEntries.length === 0) return NO_LABOR_COST;
  return calculateBurdenedLaborCost(
    jobTimeEntries.filter((entry) => entry.lineItemId === null).map(toPlainEntry),
    schedulesByCraft,
    burdenRates,
  );
}
