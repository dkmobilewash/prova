import { ARCHITECTURAL_SCALES, ENGINEERING_SCALES } from "./scaleFromDimensions";
import { LABELS_FOR_A_RULER, rulerLadder, type ScaleLabel } from "./scaleBar";

/**
 * THE GRAPHIC SCALE BAR, READ AS A SCALE.
 *
 * ── READ THIS FIRST: ON REAL DRAWINGS THIS WITNESS IS NEARLY ALWAYS ABSENT ──
 *
 * Measured on 2026-10-14 over 218 pages of four real bid sets, AFTER this file
 * was written and against the expectation that built it: **the bar reads 3 of
 * 218 pages, and rescues 0 of the 91 pages no other witness could read.**
 *
 * The instrument is not the problem, which was checked separately rather than
 * assumed. Of those 218 pages, 185 carry three or more bare numbers and only 57
 * carry a number equal to zero; 29 have a row of three starting at zero, and 3
 * of those are ladders. The near-misses are `0,0,0`, `0,1,2`, `0,1,150`,
 * `0,4,6,9` — sheet-number and revision fragments, not rulers being wrongly
 * rejected. The bar is simply not there AS TEXT.
 *
 * `scaleBar.ts` predicted exactly this in its own header: *"A bar whose numbers
 * were drawn as line work rather than text is not caught."* A modern CAD set
 * prints `SCALE: 1/8" = 1'-0"` as text instead, which is why the printed-scale
 * reader carries 94 of those 218 pages while this carries 3.
 *
 * ── SO WHY IS IT HERE AT ALL ──
 *
 * Because it is RIGHT when it fires — 3 of 3 agreement with the dimension
 * reader, zero contradictions — it costs one pass over labels the page has
 * already extracted, and `scaleAudit.ts` reports it as its own column so the
 * next real set can change this answer without anybody rebuilding it.
 *
 * **It is deliberately NOT wired into the production scale picker.** A witness
 * worth 1.4% does not belong in a consensus a bid is priced from, and wiring it
 * on the strength of three pages is how a number nobody measured gets believed.
 * If a set ever comes back where the bar rescues real pages, that is the
 * evidence to wire it on — and the column will say so.
 *
 * Everything below this line was the reasoning that justified building it. It is
 * kept because it is still true about the cases where a bar DOES exist, and
 * because the argument was good and the data still said no:
 *
 * It is different in kind from the other three rather than more of the same:
 *
 *   - **It is immune to page scaling.** A reduced print carries the FULL-SIZE
 *     scale name in its title block, so the name lies — `reducedPrint.ts` exists
 *     to catch that. The BAR is drawn in the same space as the plan, so it
 *     shrinks with it and never lies.
 *   - **It needs no other sheet.** `reducedPrint.ts` compares a page against the
 *     set's own modal width, so a sub who uploads ONE sheet gets nothing from
 *     it. A bar is read from the sheet alone.
 *   - **It is a measurement, not a name.** Like `scaleFromDimensions` and unlike
 *     the title block, the evidence can be drawn back over the thing it came
 *     from, so a wrong one is visible in two seconds. That is why `labels` comes
 *     back with the answer.
 *
 * ── IT READS THE NUMBERS AND NEVER THE BAR, WHICH IS `scaleBar.ts`'S OWN POINT ──
 *
 * That file says it in as many words: *"What distinguishes a scale bar is not
 * its geometry — it is that somebody printed a ruler's numbers along it."* The
 * numbers ARE the ruler. So nothing here looks for strokes, which is what makes
 * it usable before a scale exists at all: `wallsFromStrokes` works in feet of
 * building and cannot run until something has already answered this question.
 *
 * ── WHY A ROW OF NUMBERS IS NOT A COINCIDENCE ──
 *
 * `rulerLadder` carries the test and the reasoning. In short: three or more bare
 * numbers, ascending, **starting at zero**, and proportional to their own
 * spacing. The zero is the safety — room numbers run 110, 111, 112; a grid is
 * lettered once at its bubble; a dimension string is one item reading `30'-0"`,
 * which `BARE_NUMBER` does not match. The proportionality is what makes the
 * reading worth having rather than merely recognised.
 *
 * ── AND IT REFUSES RATHER THAN GUESSES, IN THREE PLACES ──
 *
 * A wrong scale is this product's worst failure: every quantity is wrong by the
 * same factor, so nothing looks odd and the bid is simply wrong. So a reading
 * that is not a standard scale is refused rather than rounded (the same call
 * `reducedPrint.ts` makes), and two bars that disagree return nothing at all
 * instead of a vote.
 *
 * Pure. No database, no React, no PDF.
 */

/** How close a read scale must sit to a standard one to be called it. The same
 *  2% `scaleFromDimensions` and `takeoff-plan.ts` use, for the same reason:
 *  it absorbs where the drawing program centred the label, not measurement
 *  slack — the label positions themselves are exact. */
const SCALE_TOLERANCE = 0.02;

/**
 * How far apart two labels' baselines may sit and still be one bar, as a
 * fraction of the row's own span.
 *
 * RELATIVE, so this needs no notion of paper size — which it could not have,
 * since the scale is what is being worked out. A bar 4 paper inches long sets
 * its numbers within a few points of one baseline; a tenth of the span is
 * generous and still excludes the row of numbers in a schedule two inches below.
 */
const SAME_BAR = 0.1;

/** A bar's reading, or why there isn't one. The shape `reducedPrint.ts` uses,
 *  because an estimator reads the refusal as often as the answer. */
export type BarScale =
  | {
      ok: true;
      /** Feet of building per page-width unit — what the takeoff works in. */
      feetPerUnit: number;
      feetPerInch: number;
      /** The standard scale this was read as. */
      scaleName: string;
      /** The labels it was read from, so the viewer can draw the evidence. */
      labels: ScaleLabel[];
    }
  | { ok: false; reason: string };

/** The standard scale a reading is, if it is one. */
function nameFor(feetPerInch: number): string | null {
  for (const scale of ARCHITECTURAL_SCALES) {
    if (Math.abs(scale.feetPerInch - feetPerInch) / scale.feetPerInch <= SCALE_TOLERANCE) {
      return scale.name;
    }
  }
  for (const feet of ENGINEERING_SCALES) {
    if (Math.abs(feet - feetPerInch) / feet <= SCALE_TOLERANCE) return `1" = ${feet}'`;
  }
  return null;
}

/**
 * Rows of labels that share a baseline.
 *
 * HORIZONTAL ONLY, said plainly rather than half-handled: a vertical graphic
 * scale exists but is vanishingly rare on an architectural sheet, and a
 * half-built vertical case would be a path nothing ever measured.
 */
function rows(labels: readonly ScaleLabel[]): ScaleLabel[][] {
  const byY = [...labels].sort((a, b) => a.y - b.y);
  const out: ScaleLabel[][] = [];
  let current: ScaleLabel[] = [];
  for (const label of byY) {
    if (current.length === 0) {
      current = [label];
      continue;
    }
    const span = Math.max(...current.map((one) => one.x)) - Math.min(...current.map((one) => one.x));
    // Compared against the row's own span, with a floor so the first pair of a
    // row has something to be compared against.
    const reach = Math.max(span, 0.02) * SAME_BAR;
    if (label.y - current[current.length - 1].y <= reach) current.push(label);
    else {
      out.push(current);
      current = [label];
    }
  }
  if (current.length > 0) out.push(current);
  return out.filter((row) => row.length >= LABELS_FOR_A_RULER);
}

/**
 * The scale this sheet's own graphic bar implies.
 *
 * `labels` comes from `scaleBarLabels`, already in page-width units, so one pass
 * over the page's text serves this, the wall-type tags and the bar exclusion.
 * `widthPt` turns the answer into feet per inch, which is the only place a paper
 * dimension enters — and it is the page's own, not an assumption about paper.
 */
export function scaleFromBar(labels: readonly ScaleLabel[], widthPt: number): BarScale {
  if (!(widthPt > 0)) return { ok: false, reason: "This sheet reports no width." };
  if (labels.length < LABELS_FOR_A_RULER) {
    return { ok: false, reason: "No graphic scale bar was found on this sheet." };
  }

  const found: { feetPerUnit: number; scaleName: string; labels: ScaleLabel[] }[] = [];
  for (const row of rows(labels)) {
    const ladder = rulerLadder(row.map((one) => ({ at: one.x, value: one.value })));
    if (ladder === null) continue;
    const feetPerInch = (ladder.feetPerUnit * 72) / widthPt;
    const scaleName = nameFor(feetPerInch);
    // NOT A STANDARD SCALE, NOT AN ANSWER. A bar landing between scales means
    // something is wrong with the reading or the page, and either way it is not
    // worth betting a bid on — the same call `printedScaleForSheet` makes.
    if (scaleName === null) continue;
    found.push({ feetPerUnit: ladder.feetPerUnit, scaleName, labels: row });
  }

  if (found.length === 0) {
    return { ok: false, reason: "No graphic scale bar was found on this sheet." };
  }

  // TWO BARS THAT DISAGREE RETURN NOTHING. A sheet carrying views at two scales
  // is a real thing — the audit over four real sets found 21 pages of them — and
  // a single number for such a sheet is wrong whichever bar wins.
  const names = new Set(found.map((one) => one.scaleName));
  if (names.size > 1) {
    return {
      ok: false,
      reason:
        `This sheet carries ${names.size} graphic scale bars reading different scales ` +
        `(${[...names].join(", ")}), so no one scale covers it. Set the scale by clicking a known distance ` +
        `on the view you are measuring.`,
    };
  }

  const best = found[0];
  return {
    ok: true,
    feetPerUnit: best.feetPerUnit,
    feetPerInch: (best.feetPerUnit * 72) / widthPt,
    scaleName: best.scaleName,
    labels: best.labels,
  };
}
