import { ARCHITECTURAL_SCALES } from "./scaleFromDimensions";

/**
 * ── A HALF-SIZE PRINT LIES ABOUT ITS OWN SCALE, AND ONE REAL PAGE PROVES IT ──
 *
 * A reduced print carries the FULL-SIZE scale name in its title block, because
 * the title block was drawn long before anyone chose what paper to issue it on.
 * So the name says `1/8" = 1'-0"` and the paper is physically 1/16" = 1'-0".
 *
 * This is not hypothetical. On the 60-page answer key, three pages are half-size
 * prints of an ARCH D original, and they divide exactly along whether the
 * DIMENSION path happened to work:
 *
 *   | page | width | labels | dimensions say | the app uses | key score |
 *   | --- | --- | --- | --- | --- | --- |
 *   | 11 | 18in | 20 | 16.00 ft/in | 16.00, measured | 66% |
 *   | 17 | 18in | 32 | 16.00 ft/in | 16.00, measured | 66% |
 *   | **50** | **18in** | **0** | **declined** | **8.00, from the NAME** | **32%** |
 *
 * p50 is measured at HALF its real scale; its own sister pages prove what that
 * scale is; and it scores worst of all sixty pages in the key. Every quantity
 * off a sheet like that is half — not a rounding error, half the job.
 *
 * ── THE DETECTOR, AND THE TWO THAT WERE TRIED FIRST ──
 *
 * **An absolute lettering threshold does not work.** Measured across 548 real
 * drawing pages: modal body lettering on 36in sheets runs 4.50pt to 40.25pt, and
 * the key's own FULL-SIZE pages sit at 4.50 — below the half-size pages of other
 * sets. Any fixed floor flags real full-size sheets.
 *
 * **Checking the printed name against raw `scaleCandidates` does not work, and
 * fails DANGEROUSLY.** Tried, and the corpus caught it: on Naples p9 that
 * version "corrected" 8.00 ft/in to 32.00 on 38 backing candidates, while that
 * page's own dimension vote independently said 8.00. `scaleCandidates` emits
 * every plausible label-to-segment pairing, so spurious clean multiples are
 * abundant — they are hypotheses for a vote to weigh, never evidence to count.
 * Do not rebuild it that way.
 *
 * **What works is that the SET is its own control.** A reduction is something
 * done to a whole sheet, so the page itself comes out a clean fraction of the
 * size the office issues at. Two independent measurements of that both score
 * perfectly over nine sets and 548 pages — the page WIDTH, and the title-block
 * LETTERING, which scales with it:
 *
 *   | rule | caught | false positives |
 *   | --- | --- | --- |
 *   | page width vs the set's modal width | **3 of 3** | **0** |
 *   | title-block lettering vs the set's template | 3 of 3 | 0 |
 *
 * This uses the WIDTH, for one reason: `PlanSheetText.widthPt` is already stored
 * for every page, so it needs no migration and no new extraction. The lettering
 * is the stronger evidence in principle — it proves the template itself was
 * scaled, which a genuinely small sheet would not do — and is the thing to reach
 * for if a false positive ever appears. That is written down because the two
 * were measured together and the choice between them was availability, not
 * quality.
 *
 * ── THE CASE THIS CANNOT TELL APART, STATED PLAINLY ──
 *
 * A set that is mostly ARCH D with a GENUINE ARCH B sheet in it looks identical
 * to a half-size print. No page in the corpus is that, so the rule is unmeasured
 * there rather than proven safe. Three things keep it survivable: the correction
 * only ever runs where the dimension vote already declined, the corrected value
 * must itself be a standard architectural scale, and the screen says the sheet
 * was corrected and why — so an estimator looking at a genuine small sheet can
 * see the claim and disagree with it.
 */

/** How close the ratio must be to a whole reduction to count. 3% — a reduction
 *  is exact, so this only absorbs rounding in a reported page box. */
const CLEAN_RATIO = 0.03;

/**
 * The reductions a drawing is actually issued at. Half-size is the common one —
 * it is what gets printed for the field, and a sub is often sent that set.
 *
 * Enlargements are deliberately absent: nobody issues a drawing larger than it
 * was drawn, and admitting the possibility would double the hypotheses this has
 * to tell apart for no case anyone has seen.
 */
const REDUCTIONS = [2, 4] as const;

export type ReducedPrint = {
  /** 1 when the sheet is as drawn; 2 for a half-size print. */
  factor: number;
  /** The width the set is issued at, for the evidence line. */
  setWidthPt: number;
  /** This sheet's own width. */
  sheetWidthPt: number;
};

/**
 * Is this sheet a reduced print of the set it belongs to?
 *
 * Returns factor 1 when there is no clean reduction, which is the answer for
 * every ordinary sheet and for every case where the measurement is missing.
 */
export function reducedPrint(sheetWidthPt: number, setWidthPt: number): ReducedPrint {
  const asDrawn = { factor: 1, setWidthPt, sheetWidthPt };
  if (!(sheetWidthPt > 0) || !(setWidthPt > 0)) return asDrawn;
  const ratio = setWidthPt / sheetWidthPt;
  for (const factor of REDUCTIONS) {
    if (Math.abs(ratio - factor) / factor <= CLEAN_RATIO) return { factor, setWidthPt, sheetWidthPt };
  }
  return asDrawn;
}

/**
 * The width the set is issued at, as the MODAL page width across its sheets.
 *
 * Modal rather than maximum on purpose. The maximum would be whichever single
 * sheet happens to be biggest — one oversized sheet in a set would make every
 * other page read as a reduction of it. The mode is the size the office
 * actually issues at, and it is robust to a handful of odd sheets.
 *
 * Widths are bucketed to a whole point before counting: a page box arrives as a
 * float and 2591.999 and 2592 are the same sheet.
 */
export function setSheetWidth(widths: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const pt of widths) {
    if (!(pt > 0)) continue;
    const bucket = Math.round(pt);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  if (counts.size === 0) return 0;
  // Ties go to the LARGER size: a set with as many reduced sheets as full-size
  // ones should take the full-size one as the reference, because a reduction is
  // a thing done to an original and not the other way round.
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

export type PrintedScaleCheck =
  | { ok: true; feetPerInch: number; scaleName: string; corrected: false }
  | { ok: true; feetPerInch: number; scaleName: string; corrected: true; factor: number; caution: string }
  | { ok: false; reason: string };

/**
 * Correct a printed scale name for a reduced print.
 *
 * ── WHERE THIS IS ALLOWED TO ACT, WHICH IS THE WHOLE SAFETY ARGUMENT ──
 *
 * Only on a sheet whose DIMENSION vote has already declined. It therefore never
 * overrides a measured scale — it only improves a reading otherwise taken from a
 * title block with nothing checking it, which is exactly the case p50 proves is
 * wrong today.
 *
 * Three independent conditions must all hold before a number changes: the sheet
 * is a clean whole fraction of the set's own size, the set has a modal size to
 * compare against, and **the corrected value is itself a standard architectural
 * scale**. A reduction landing between scales is refused rather than rounded —
 * at that point the two readings disagree and neither is worth betting a bid on.
 */
export function printedScaleForSheet(
  printedFeetPerInch: number,
  print: ReducedPrint,
): PrintedScaleCheck {
  if (!(printedFeetPerInch > 0)) {
    return { ok: false, reason: "The printed scale on this sheet could not be read as a distance." };
  }
  if (print.factor === 1) {
    return {
      ok: true,
      feetPerInch: printedFeetPerInch,
      scaleName: nameFor(printedFeetPerInch) ?? `${printedFeetPerInch} ft per inch`,
      corrected: false,
    };
  }

  const corrected = printedFeetPerInch * print.factor;
  const name = nameFor(corrected);
  const size = describe(print);
  if (name === null) {
    // The paper says reduced and the arithmetic lands on no real scale. Both
    // readings cannot be right, so neither is offered.
    return {
      ok: false,
      reason:
        `This sheet looks like a ${size} print — it is ${inches(print.sheetWidthPt)} wide against ` +
        `${inches(print.setWidthPt)} on the rest of the set — but the scale that implies is not a standard ` +
        `one. Set the scale by clicking a known distance instead.`,
    };
  }
  return {
    ok: true,
    feetPerInch: corrected,
    scaleName: name,
    corrected: true,
    factor: print.factor,
    caution:
      `This sheet is ${inches(print.sheetWidthPt)} wide against ${inches(print.setWidthPt)} on the rest of the ` +
      `set, so it is a ${size} print. The scale printed on it is the full-size one, so ${name} is being offered ` +
      `instead — otherwise every length off this sheet would be ${print.factor === 2 ? "half" : `a quarter of`} ` +
      `what it should be. Check one known distance before you bid off it.`,
  };
}

/** The architectural scale this many feet per inch is, if it is one. */
function nameFor(feetPerInch: number): string | null {
  for (const scale of ARCHITECTURAL_SCALES) {
    if (Math.abs(scale.feetPerInch - feetPerInch) / scale.feetPerInch <= 0.02) return scale.name;
  }
  return null;
}

function describe(print: ReducedPrint): string {
  return print.factor === 2 ? "half-size" : `1/${print.factor}-size`;
}

/** Paper inches, for a sentence an estimator reads rather than a point count. */
function inches(pt: number): string {
  const n = pt / 72;
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}in`;
}
