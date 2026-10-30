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
