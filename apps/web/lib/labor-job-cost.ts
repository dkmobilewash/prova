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
// IT DOES NOT INVENT A COSTING RULE. The burden math is
// `calculateTimeEntryLaborCost` and the schedule lookup is
// `findEffectiveFringeRateSchedule`, used exactly the way
// lib/certified-payroll.ts uses them, so a dollar on the job page and a
// dollar on a WH-347 come from the same arithmetic.

import {
  calculateTimeEntryLaborCost,
  findEffectiveFringeRateSchedule,
  type FringeRateScheduleInput,
  type TimeEntryPayType,
} from "./labor-cost";
import { NO_LABOR_COST, type WipLaborCost } from "./wip";

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
): WipLaborCost {
  let wageCost = 0;
  let allowanceCost = 0;
  let pricedHours = 0;
  let unpricedHours = 0;

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
    }

    allowanceCost += (entry.perDiemAmount ?? 0) + (entry.travelPayAmount ?? 0);
  }

  return {
    wageCost,
    allowanceCost,
    total: LABOR_ALLOWANCES_IN_JOB_COST ? wageCost + allowanceCost : wageCost,
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
type DecimalLike = number | string | { toString(): string };

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
): LineItemCostToDate {
  const manualCost = costEntries.reduce((sum, entry) => sum + num(entry.amount), 0);
  const labor = calculateBurdenedLaborCost(
    jobTimeEntries.filter((entry) => entry.lineItemId === lineItemId).map(toPlainEntry),
    schedulesByCraft,
  );
  return { actualCostToDate: manualCost + labor.total, labor };
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
): WipLaborCost {
  if (jobTimeEntries.length === 0) return NO_LABOR_COST;
  return calculateBurdenedLaborCost(
    jobTimeEntries.filter((entry) => entry.lineItemId === null).map(toPlainEntry),
    schedulesByCraft,
  );
}
