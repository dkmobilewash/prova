import { bidRecap, RECAP_RATE_KEYS, type CostCategoryValue, type RecapRates } from "@/lib/bid-recap";
import type { RecapState } from "@/lib/estimating/proposal-recap-currency";

/**
 * DID THE BID RECAP'S RATES REACH THESE PRICES — assembled once.
 *
 * ── WHY THIS IS A SHARED FUNCTION AND NOT A BLOCK ON A PAGE ──
 *
 * It was forty lines inside `jobs/[id]/proposal/page.tsx`, and the job page
 * needed the same answer for its "needs you" list. Copying it would have put a
 * second money judgement in the codebase, and the two would have disagreed on
 * the day either was edited — with the disagreement visible only as a job page
 * that says the markup is fine and a proposal that prints un-marked-up prices.
 *
 * That is the shape this repo keeps paying for: `findWallsOnSheet` was lifted
 * for the same reason, after the bench's copy drifted and started inventing
 * walls.
 *
 * ── THE TWO NUANCES THAT MAKE IT WORTH CALLING RATHER THAN REWRITING ──
 *
 * **`budgetedUnitCost`, never `currentEstimatedUnitCost`** (#512). The recap
 * marks up COST; the latter is the PM's live re-forecast, which is a different
 * number for a different purpose, and using it would mark up a figure that
 * moves after the bid went out.
 *
 * **The JOB's own recap row only, never `CompanyBidDefaults`.** The estimate tab
 * legitimately falls back to the defaults because it is a FORM pre-filling an
 * unsaved row. This answers "did the rates reach these prices", and company
 * defaults nobody has opened on this job have not reached anything.
 *
 * `addedTotal` is recomputed from the job's current lines rather than read off a
 * column, because the recap stores percentages and never money — "a stored
 * total is wrong the moment a line changes" (`bid-recap.prisma`).
 */

/** A job line, as both callers already have it from Prisma. */
export type RecapLine = {
  id: string;
  quantity: unknown;
  budgetedUnitCost: unknown;
  unitPrice: unknown;
  costCategory: string | null;
};

/** The job's own recap row, or null when it has none. */
export type RecapRow = {
  appliedAt: Date | null;
  appliedTotal: unknown;
} & Record<string, unknown>;

const num = (value: unknown): number | null => (value != null ? Number(value) : null);

/** The lines in the shape `bidRecap` and `bidMargin` both read. */
export function recapLines(lines: readonly RecapLine[]) {
  return lines.map((line) => ({
    id: line.id,
    quantity: Number(line.quantity),
    unitCost: num(line.budgetedUnitCost),
    unitPrice: num(line.unitPrice),
    costCategory: (line.costCategory as CostCategoryValue | null) ?? null,
  }));
}

export function recapStateFor(recapRow: RecapRow | null, lines: readonly RecapLine[]): RecapState | null {
  if (!recapRow) return null;
  return {
    addedTotal: bidRecap(
      recapLines(lines),
      Object.fromEntries(
        RECAP_RATE_KEYS.map((key: string) => [key, num(recapRow[key])]),
      ) as RecapRates,
    ).addedTotal,
    appliedAt: recapRow.appliedAt,
    appliedTotal: num(recapRow.appliedTotal),
  };
}

/**
 * WHAT THE BID COMES TO — the number `proposalPriceState` is comparing the
 * recap against, so both callers must compute it the same way.
 *
 * A NULL UNIT PRICE IS A COST-ONLY LINE (general conditions, overhead): it
 * prints with no price and counts $0 toward the bid total, which is the rule
 * the contract value uses everywhere else. Treating it as zero cost rather than
 * zero price would be a different number.
 *
 * THE ONE SUM OF QUANTITY × PRICE FOR "THE BID", and since 2026-10-19 (bug C)
 * that is literally true: the job header (`loadJobSummary`) and the bid recap's
 * "Bid on the job now" row read it too. The header used to add the lines up
 * itself, so the screen carried one figure called BID in the header and another
 * called Bid total in the recap with nothing tying either to the proposal's.
 * Typed on the two fields it reads, so a caller holding numbers (the recap's
 * lines) and one holding Prisma decimals (the header's) both pass.
 */
export function bidTotalOf(lines: readonly Pick<RecapLine, "quantity" | "unitPrice">[]): number {
  return lines.reduce((sum, line) => {
    const unitPrice = num(line.unitPrice);
    return sum + (unitPrice === null ? 0 : Number(line.quantity) * unitPrice);
  }, 0);
}
