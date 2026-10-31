import { doorSymbols } from "./doorWindowSymbols";
import { ARCHITECTURAL_SCALES } from "./scaleFromDimensions";
import { calibrationForView } from "./sheetScale";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── A SCALE PROPOSED FROM THE DOORS, FOR A PERSON TO CONFIRM ──
 *
 * 1,300 sheets across the real sets print no scale and no dimension the reader
 * can use. Their doors still tell. Measured on training sheets with the printed
 * scale hidden: at the true scale, door leaves land on whole inches (36, 34,
 * 32, 30, 28), and at a wrong standard scale they mostly do not. So each
 * standard scale is tried and the one that puts the most doors on real door
 * sizes wins, if it wins clearly. 183 sheets: 76 right, 1 wrong, 106 refused.
 *
 * It is a proposal and nothing more. One wrong door scale multiplies through
 * every wall on a sheet, so this writes nothing: `TakeoffScaleSuggestion`
 * shows it and only a press saves a calibration.
 *
 * Stair treads were measured as a second signal and dropped: 5 right, 27 wrong,
 * because brick and tile hatching is even parallel lines too.
 */

/** Scales a floor plan is drawn at. 1/32" is left out: a sink's arc reads as a 3'-0" door there. */
const CANDIDATES = ARCHITECTURAL_SCALES.filter((s) => s.feetPerInch >= 2 && s.feetPerInch <= 16);
/** Sizes doors are bought in, inches. */
const DOOR_INCHES = [24, 28, 30, 32, 34, 36, 42, 48];
/** The sizes that decide it: a 24" or 48" leaf is half or double another, so it proves little. */
const CORE_INCHES = [28, 36] as const;
const TOLERANCE_INCHES = 0.75;
export const FEWEST_DOORS = 5;
/** Of the swings on the sheet, how many must land on a core size. */
const SHARE = 0.5;
/** How far the winner must beat the next scale. */
const MARGIN = 2;

export type SuggestedScale = { scaleName: string; feetPerInch: number; doors: number };

/**
 * Only where nothing better is known. A sheet of several views has a scale per
 * view, and one figure for the whole page would be wrong on most of it.
 */
export function wantsSuggestion(sheet: { calibrated: boolean; readOnly: boolean; labelling: boolean; printedPrefill: boolean; viewScales: number }): boolean {
  return !sheet.calibrated && !sheet.readOnly && !sheet.labelling && !sheet.printedPrefill && sheet.viewScales === 0;
}

export function suggestScaleFromDoors(segmentsPt: readonly StrokeSegment[]): SuggestedScale | null {
  const scored = CANDIDATES.map(({ name, feetPerInch }) => {
    const leaves = doorSymbols(segmentsPt, [], feetPerInch / 72).map((d) => (d.widthFeet / (d.leaves === 2 ? 2 : 1)) * 12);
    const core = leaves.filter(
      (inches) =>
        inches >= CORE_INCHES[0] - TOLERANCE_INCHES &&
        inches <= CORE_INCHES[1] + TOLERANCE_INCHES &&
        DOOR_INCHES.some((door) => Math.abs(inches - door) <= TOLERANCE_INCHES),
    ).length;
    return { scaleName: name, feetPerInch, core, swings: leaves.length };
  }).sort((a, b) => b.core - a.core);
  const [best, next] = scored;
  if (best === undefined || best.core < FEWEST_DOORS) return null;
  if (best.core / best.swings < SHARE) return null;
  if (next !== undefined && next.core * MARGIN > best.core) return null;
  return { scaleName: best.scaleName, feetPerInch: best.feetPerInch, doors: best.core };
}

/** The line a confirmed suggestion saves: the sheet's width, at that scale. Page-width units. */
export function suggestedCalibration(s: SuggestedScale, page: { widthPt: number; heightPt: number }) {
  return calibrationForView(
    { name: "whole sheet", scaleName: s.scaleName, feetPerInch: s.feetPerInch, from: 0, to: 1, fromY: 0, toY: page.heightPt / page.widthPt },
    page.widthPt,
  );
}

/** The form the ordinary calibration action takes, so a confirmed suggestion is an ordinary scale. */
export function suggestionForm(
  s: SuggestedScale,
  sheet: { planId: string; pageNumber: number; widthPt: number; heightPt: number },
): FormData {
  const line = suggestedCalibration(s, sheet);
  const form = new FormData();
  form.set("planId", sheet.planId);
  form.set("pageNumber", String(sheet.pageNumber));
  form.set("pageWidthPt", String(sheet.widthPt));
  form.set("points", JSON.stringify({ xs: [line.x1, line.x2], ys: [line.y1, line.y2] }));
  form.set("declaredDistanceFeet", String(line.declaredDistanceFeet));
  form.set("note", `${s.scaleName}, suggested from ${s.doors} doors and confirmed by the estimator`);
  return form;
}
