import { money } from "@/lib/money";
import type { WipScheduleRow } from "@/lib/wip-schedule";

/**
 * One cell of the WIP schedule, as a person reads it on screen.
 *
 * The CSV has said this in its own preamble since it shipped:
 *
 *   "Blank cells — Not a zero. A figure is left blank where under 80% of
 *    the job's value carries the estimate it depends on, so the number
 *    would describe missing data rather than the job."
 *
 * A spreadsheet can carry that sentence at the top and leave the cell
 * genuinely empty. A screen cannot: an empty table cell reads as nothing
 * rather than as a statement, and `$0.00` in a gross-profit column reads
 * as a job that broke even. **Those are three different facts and only one
 * of them is true**, so this module refuses to let null and zero look
 * alike.
 *
 * Nullable columns therefore render an EM DASH with a `title` saying why,
 * never a zero and never blank. `wipScheduleCell` returns both, so a
 * caller cannot render the mark without the explanation.
 *
 * WHY THE FORMATTING IS HERE RATHER THAN IN THE COMPONENT. This is the
 * whole correctness of the page — every other decision on it is layout —
 * and a `.tsx` that has to be rendered to be checked is a rule nobody
 * mutation-tests. Pure in, string out.
 */

/** Columns whose value is a 0..1 ratio already scaled to percentage
 * points by `wipScheduleRow`, not money. */
const PERCENT_COLUMNS = new Set<keyof WipScheduleRow>([
  "percentComplete",
  "costCoverage",
  "earnedCoverage",
  "estimateCoverage",
]);

/** Columns that are plain text, not a figure. */
const TEXT_COLUMNS = new Set<keyof WipScheduleRow>(["job", "customer", "status"]);

/** Hours, which are neither money nor a ratio — see
 * `WipScheduleRow.unpricedLaborHours`, where zero is a FACT (every hour
 * priced) rather than a silence. */
const HOUR_COLUMNS = new Set<keyof WipScheduleRow>(["unpricedLaborHours"]);

export const CANNOT_SAY = "—";

export const CANNOT_SAY_TITLE =
  "Not zero — not enough of this job carries the estimate this figure depends on. " +
  "The coverage columns say how much is covered.";

export interface WipCell {
  /** What to print. */
  text: string;
  /** A `title`, present only when `text` is the cannot-say mark — so the
   * mark can never be rendered without its reason. */
  title?: string;
  /** Right-align figures, left-align words. Layout, but derived from the
   * same column knowledge, so it cannot drift from the formatting. */
  numeric: boolean;
}

export function wipScheduleCell(key: keyof WipScheduleRow, value: WipScheduleRow[keyof WipScheduleRow]): WipCell {
  if (TEXT_COLUMNS.has(key)) {
    // A missing NAME is a different problem from a missing FIGURE, and an
    // em dash here would borrow a meaning that does not apply.
    return { text: typeof value === "string" && value !== "" ? value : "", numeric: false };
  }

  if (value === null || value === undefined) {
    return { text: CANNOT_SAY, title: CANNOT_SAY_TITLE, numeric: true };
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    // Neither a number nor an honest blank. Says so rather than printing
    // "NaN" or silently becoming a dash that claims a coverage problem.
    return { text: String(value), numeric: true };
  }

  if (PERCENT_COLUMNS.has(key)) return { text: `${value}%`, numeric: true };
  if (HOUR_COLUMNS.has(key)) return { text: `${value}`, numeric: true };
  return { text: money(value), numeric: true };
}
