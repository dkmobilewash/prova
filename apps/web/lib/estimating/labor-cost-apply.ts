import { estimateBurdenedLaborCost } from "@/lib/estimate-labor-cost";
import { estimatedHours } from "@/lib/labor-productivity";
import type { FringeRateScheduleInput } from "@/lib/labor-cost";

/**
 * WHAT "USE THIS AS THE COST" WOULD DO TO ONE LINE, OR WHY IT IS NOT OFFERED.
 *
 * ── THE DEFECT, AND WHY A BUTTON RATHER THAN A BACKFILL ──
 *
 * The 2026-10-04 workflow audit found a line carrying 80 hours of Local 300
 * journeyman with `costCategory: LABOR` and no `budgetedUnitCost` contributing
 * **$0** to the bid, while the screen printed "≈ $5,600 labor" beside it. The
 * app had derived the right number and then not carried it anywhere —
 * `ARCHITECTURE.md` calls that general shape "the single biggest source of
 * error, wasted time, and mistrust in this workflow, and the reason this product
 * exists".
 *
 * It is still not filled in automatically, and four places in this repo are
 * right about why: `setLineBudgetedCost`'s *"DELIBERATELY NOT A 'COPY PRICES
 * INTO COSTS' BUTTON … One number at a time, each one the estimator's own"*;
 * `bid-recap.ts`'s *"deliberately not softened by a backfill"*; the schema's
 * *"never filled in from `unitPrice` … No backfill was ever run"*. A button an
 * estimator presses is a different thing from a backfill — `applyBidRecap` is
 * the standing precedent, *"a decision with a date on it, not a side effect of
 * typing a percentage"*.
 *
 * ── THE SIGNATURE IS THE GUARD ──
 *
 * Copied from `catalog-quote-price.ts`: there is nowhere here for a number the
 * browser sent to come in. The hours, the craft's fringe schedules, the burden
 * percentage and the date all come from the server; the request decides only
 * WHICH line. A pure decision the action and the screen both call, so the button
 * and the sentence beside it cannot disagree — two implementations of "what this
 * would do" is how a button comes to contradict the text above it.
 *
 * ── WHY A NON-LABOR LINE IS REFUSED RATHER THAN HANDLED ──
 *
 * A `JobLineItem` carries ONE `costCategory` and ONE `budgetedUnitCost`. There
 * is no labor/material split on a line anywhere in the schema. So on a "hang and
 * finish 5,000 SF" line coded MATERIAL, writing the labor cost would not add to
 * the material cost — it would REPLACE it, silently, and the bid would go out
 * missing its board. Splitting such a line into a labor line and a material line
 * is the estimator's call, not this function's.
 */

/** Everything about one line this decision is allowed to see. */
export type LaborCostLine = {
  quantity: number;
  laborHours: number | null;
  productionRate: number | null;
  budgetedUnitCost: number | null;
  costCategory: string | null;
};

export type LaborCostApplyDecision =
  | { ok: false; error: string }
  | {
      ok: true;
      /** The whole line's labor cost — what the hint shows. */
      lineTotal: number;
      /** What would be written to `budgetedUnitCost`, already rounded. */
      unitCost: number;
      hours: number;
    };

/**
 * Rounded to the cent, because `budgetedUnitCost` is `Decimal(12,2)` and this is
 * the one place the figure stops being a float and becomes money.
 *
 * `Math.round` — half away from zero — rather than a floor: a floor would make
 * every applied line very slightly cheap, and a bid that is systematically a
 * fraction under its own cost is the direction that loses money. Nothing
 * upstream rounds (see `estimateBurdenedLaborCost`'s header), so this is the
 * single rounding between the fringe schedule and the bid.
 */
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function laborCostApplyDecision(
  line: LaborCostLine,
  schedules: FringeRateScheduleInput[],
  asOf: Date,
  employerBurdenPercent: number | null,
): LaborCostApplyDecision {
  if (line.costCategory !== "LABOR") {
    const coded = line.costCategory === null ? "not coded to a cost type" : `coded ${line.costCategory.toLowerCase()}`;
    return {
      ok: false,
      error:
        `This line is ${coded}, and a line carries one cost. Writing labor here would replace that cost rather ` +
        `than add to it. Split the labor onto its own line coded LABOR, and this will offer to price it.`,
    };
  }

  const hours = estimatedHours({
    quantity: line.quantity,
    laborHours: line.laborHours,
    productionRate: line.productionRate,
  });
  if (hours === null || hours <= 0) {
    return {
      ok: false,
      error:
        "This line has no labor hours. Enter the hours, or a production rate the quantity can be divided by, " +
        "and this will price them.",
    };
  }

  const lineTotal = estimateBurdenedLaborCost(hours, schedules, asOf, employerBurdenPercent);
  if (lineTotal === null) {
    // `estimateBurdenedLaborCost` never guesses a rate, "because a wrong one
    // gets bid". That refusal is inherited rather than second-guessed here.
    return {
      ok: false,
      error:
        "No fringe rate schedule is effective for this line's craft on the date this job is priced at. " +
        "Pick a craft on the line, or record a schedule that covers that date, and this will price it.",
    };
  }

  if (line.quantity <= 0) {
    // Guarded AFTER the hours and the rate, so the estimator is told about the
    // thing they can act on rather than the first thing that happens to fail.
    return {
      ok: false,
      error:
        "This line has no quantity, so there is no per-unit cost to write. The bid multiplies cost by quantity, " +
        "and a cost on a line of zero would add nothing.",
    };
  }

  const unitCost = round2(lineTotal / line.quantity);
  if (unitCost <= 0) {
    return {
      ok: false,
      error:
        "The labor on this line works out to less than half a cent per unit, which would round to nothing. " +
        "Check the quantity and the hours.",
    };
  }

  if (line.budgetedUnitCost != null && round2(line.budgetedUnitCost) === unitCost) {
    return {
      ok: false,
      error: "The budgeted cost already matches the labor on this line, so there is nothing to change.",
    };
  }

  return { ok: true, lineTotal, unitCost, hours };
}
