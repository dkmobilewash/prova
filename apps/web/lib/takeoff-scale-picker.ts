import { STANDARD_SCALES, standardScaleFromText } from "@/lib/takeoff-plan";
import { calibrationForView } from "@/lib/takeoff/sheetScale";

/**
 * ── PICKING A STANDARD SCALE, FOR THE SHEET THAT READ NONE ──
 *
 * A 30-year sub, on the slowest part of a takeoff: "architect using 3/16, the
 * measure tools we're using are 1/8 or quarter, so you need to calculate." On a
 * sheet whose dimensions could not be read, the only route was to find a
 * printed dimension, click both ends and type it — fine when there is one, and
 * slow on a sheet the estimator already knows is 3/16.
 *
 * ── NO SECOND SCALE COMPUTATION ──
 *
 * A calibration is stored as a LINE and what that line is in feet, and every
 * quantity is read through `feetPerPageWidth`. A picked scale has to become the
 * same thing, so this hands the picked ratio to `calibrationForView` — the
 * function the per-drawing caption offer already uses to turn a ratio into a
 * line — with the whole sheet as the "drawing". The line spans the sheet's own
 * width and the distance is what the scale says that width is: two facts about
 * the file, multiplied, with no dimension invented. `readScale` then names the
 * saved line back exactly as it names every other one, which
 * `takeoff-scale-picker.test.ts` asserts for every entry at three sheet sizes.
 *
 * ── AND IT IS ONLY EXACT IF THE PDF IS FULL SIZE ──
 *
 * The arithmetic uses the PDF's own page width in points (72 to the inch). A
 * vector set exported at 100% is exact. A half-size print, or a scan, still
 * says 3/16 in its title block while every inch on the page is a different
 * size — so the picker says so in one line and leaves "click a printed
 * dimension" as the way to check it.
 */

/** Every scale the picker offers — `STANDARD_SCALES` itself, not a copy. */
export const PICKABLE_SCALES = STANDARD_SCALES;

/** Architectural scales name a foot (`= 1'-0"`); engineering ones name feet. */
export function isArchitecturalScale(name: string): boolean {
  return name.endsWith("= 1'-0\"");
}

/**
 * The calibration line a picked scale stands for, in page-WIDTH units — the
 * convention `TakeoffScaleCalibration` stores — or null with nothing guessed
 * when the page size is unknown or the name is not on the list.
 */
export function pickedScaleLine(
  name: string,
  widthPt: number,
  heightPt: number,
): { xs: [number, number]; ys: [number, number]; declaredDistanceFeet: number } | null {
  const scale = PICKABLE_SCALES.find((candidate) => candidate.name === name);
  if (scale === undefined) return null;
  if (!(widthPt > 0) || !(heightPt > 0) || !Number.isFinite(widthPt) || !Number.isFinite(heightPt)) return null;
  const line = calibrationForView(
    {
      name: "this sheet",
      scaleName: scale.name,
      feetPerInch: scale.feetPerInch,
      from: 0,
      to: 1,
      fromY: 0,
      toY: heightPt / widthPt,
    },
    widthPt,
  );
  if (!Number.isFinite(line.declaredDistanceFeet) || line.declaredDistanceFeet <= 0) return null;
  return { xs: [line.x1, line.x2], ys: [line.y1, line.y2], declaredDistanceFeet: line.declaredDistanceFeet };
}

/**
 * Which scale to pre-select: the sheet's own reading first, then its title
 * block, then the caption of its ONLY drawing. Several drawings at several
 * scales have no one answer, so nothing is pre-selected for them. Every source
 * goes through `standardScaleFromText`, so a scale typed with curly quotes still
 * finds its entry and one the list does not hold (`AS NOTED`, a metric ratio)
 * pre-selects nothing.
 */
export function suggestedScalePick(sources: {
  prefillScale: string | null;
  printedScale: string | null;
  viewScales: readonly string[];
}): string | null {
  const candidates = [
    sources.prefillScale,
    sources.printedScale,
    sources.viewScales.length === 1 ? sources.viewScales[0] : null,
  ];
  for (const candidate of candidates) {
    const found = standardScaleFromText(candidate);
    if (found !== null) return found.name;
  }
  return null;
}
