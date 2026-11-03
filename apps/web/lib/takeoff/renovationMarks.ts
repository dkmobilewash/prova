/**
 * ── WHETHER A SHEET SHOWS EXISTING WORK, FROM ITS OWN WORDS ──
 *
 * On a renovation or tenant-improvement sheet the finder offers the existing
 * walls with the new ones, about twice the real new work. The scorecard's
 * marker scan (zzRealisticUser.eval) decides it from the sheet's text: `(E)`,
 * EXISTING three times, RENOVATION, REMODEL, TENANT IMPROVEMENT or DEMO. To
 * those, LIMIT OF WORK and NIC / NOT IN CONTRACT, which name an area outside
 * the job. Returned as the markers found, so the screen can say why.
 *
 * NIC never marks a sheet ON ITS OWN: it names items as often as areas, and
 * Camp Clark's new-build barracks A-101 prints it and nothing else.
 */
const RULES: { word: string; re: RegExp; min: number }[] = [
  { word: "(E)", re: /\(E\)/gi, min: 1 },
  { word: "EXISTING", re: /\bEXIST(ING)?\b/gi, min: 3 },
  { word: "RENOVATION", re: /\bRENOVATION\b/gi, min: 1 },
  { word: "REMODEL", re: /\bREMODEL/gi, min: 1 },
  { word: "TENANT IMPROVEMENT", re: /\bTENANT\s+IMPROVEMENTS?\b/gi, min: 1 },
  { word: "DEMO", re: /\bDEMO(LITION|LISH(ED)?)?\b/gi, min: 1 },
  { word: "LIMIT OF WORK", re: /\bLIMITS?\s+OF\s+(WORK|CONSTRUCTION)\b/gi, min: 1 },
  { word: "NIC", re: /\bN\.?\s?I\.?\s?C\.?(?=\W|$)|\bNOT\s+IN\s+CONTRACT\b/gi, min: 1 },
];

export function renovationMarks(words: string): string[] {
  return RULES.filter((r) => (words.match(r.re) ?? []).length >= r.min).map((r) => r.word);
}

/** Whether those markers make a sheet one that shows existing work. */
export function showsExistingWork(marks: readonly string[]): boolean {
  return marks.some((m) => m !== "NIC");
}

export const RENOVATION_PROMPT = "This sheet shows existing work. Draw the work area or exclude existing walls before sending to the estimate.";
