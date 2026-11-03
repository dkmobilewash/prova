/**
 * ── WHICH SHEETS AN ACROSS-THE-SET COUNT WALKS ──
 *
 * An estimator boxes a light fixture on E2.01 and wants every copy in the
 * set. The copies are on the other electrical sheets, not on the plumbing
 * plans, so the default scope is the sheets of the SAME DISCIPLINE — read
 * off the sheet number's leading letters the way `drawingIndex.ts` reads a
 * US commercial set: `E`, `EL`, `EP`, `ED` are all electrical; `M`, `P`,
 * `FP`, `S`, `A` are not. The first letter is the discipline; a second
 * letter is the sub-set (lighting, power, demolition), and those are wanted
 * together — a receptacle counted on EP1.01 is also on EP1.21.
 *
 * `MEP-201` is the exception a combined-trades set has, and it is treated
 * as its first letter too: a mechanical count walks it, an electrical one
 * does not, which is the lesser error — a sheet walked for nothing costs a
 * second; a sheet skipped costs a count.
 */
export type SheetScope = "discipline" | "all";

/** The discipline letter of a sheet number, or null when the number has none. */
export function sheetDiscipline(sheetNumber: string | null | undefined): string | null {
  if (!sheetNumber) return null;
  const m = /^([A-Z])[A-Z]{0,2}-?\d/i.exec(sheetNumber.trim());
  return m ? m[1]!.toUpperCase() : null;
}

/** Whether a sheet is in the scope of a count started on `fromNumber`. */
export function sheetInScope(scope: SheetScope, fromNumber: string | null, sheetNumber: string | null): boolean {
  if (scope === "all") return true;
  const want = sheetDiscipline(fromNumber);
  // A count started on a sheet with no readable number has no discipline to
  // match; walking everything is the honest fallback, and the panel says so.
  if (want === null) return true;
  return sheetDiscipline(sheetNumber) === want;
}

/** The sentence beside the scope control. */
export function scopeSentence(scope: SheetScope, fromNumber: string | null, inScope: number, total: number): string {
  const d = sheetDiscipline(fromNumber);
  if (scope === "all") return `Every sheet in the set (${total}).`;
  if (d === null) return `This sheet has no readable number, so every sheet is searched (${total}).`;
  return `Sheets numbered ${d}… like this one (${inScope} of ${total}).`;
}

/**
 * ── A LEGEND SHEET'S SYMBOLS ARE THE KEY, NOT THE WORK ──
 *
 * Baker's E0.03 is ELECTRICAL LEGEND: five R1 troffers drawn beside their
 * descriptions. They were left out of Find on all sheets only when the boxed
 * troffer happened to carry its "R1" tag into the template, which depends on a
 * few pixels of the drag: 2 tries in 16 counted them (26 against the right 21).
 * So a sheet whose own title names it a legend, or a sheet of symbols, is listed
 * and not counted, whatever the tag. A title that is also a PLAN ("LEGEND AND
 * FIRST FLOOR PLAN") is a plan and is counted.
 */
export function isLegendSheet(title: string | null | undefined): boolean {
  if (!title) return false;
  return /\b(LEGENDS?|SYMBOLS?)\b/i.test(title) && !/\bPLANS?\b/i.test(title);
}
