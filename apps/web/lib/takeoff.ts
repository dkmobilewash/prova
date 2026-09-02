/**
 * Turning measured dimensions into material quantities.
 *
 * WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT
 *
 * It is NOT drawing measurement. There is no PDF canvas, no scale
 * calibration, no click-to-measure. Somebody measures — on paper, with a
 * wheel, in Bluebeam — and types the dimensions here. Pretending otherwise
 * would be the worst version of this feature: a measuring tool that is
 * slightly wrong is more dangerous than no measuring tool, because a number
 * that came off a screen gets trusted.
 *
 * What it does is the arithmetic between a measurement and a bid, which the
 * competitor research names directly as the missing leg —
 * "takeoff-quantity-to-estimate mapping" — and which a wall-and-ceiling sub
 * currently does on a calculator, once per bid, by hand.
 *
 * EVERY CONVENTION THAT VARIES BY SHOP IS AN ARGUMENT, NOT A CONSTANT.
 *
 * Waste percentage, stud spacing, sheet size and the opening-deduction
 * threshold all differ between estimators and between jobs, and a hidden
 * default is how a takeoff tool quietly bids somebody else's practice. They
 * are all inputs with documented defaults, and the defaults are the common
 * case rather than the right answer.
 *
 * Pure and argument-taking, like wip.ts and retainage.ts. Nothing here
 * touches a database, and the numbers a bid rests on can be checked without
 * one.
 */

/** Feet. Everything in this file is feet and square feet — mixing units is
 * how a takeoff produces a number that is exactly twelve times wrong. */
export type Feet = number;
export type SquareFeet = number;

export type Opening = {
  widthFt: Feet;
  heightFt: Feet;
};

export type WallInput = {
  lengthFt: Feet;
  heightFt: Feet;
  /** Drywall on one side or both. A demising wall is two; a furring wall
   * against masonry is one. There is no sensible default, so it is required. */
  sides: 1 | 2;
  openings?: Opening[];
};

/**
 * Openings smaller than this are NOT deducted.
 *
 * The convention exists because a door or a window still costs labour to cut
 * and finish around, and deducting it underbids the work. 32 sq ft is the
 * common threshold and is roughly a single door. It is a default, not a
 * rule: shops differ, and some deduct nothing at all.
 */
export const DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT = 32;

/** A 4x8 sheet. 4x12 is common on commercial ceilings; hence an argument. */
export const DEFAULT_SHEET_AREA_SQFT = 32;

/** Metal studs at 16" on centre, in feet. 24" is common on non-load-bearing
 * partitions, which is exactly why this is not hard-coded. */
export const DEFAULT_STUD_SPACING_FT = 16 / 12;

/**
 * Gross area of one face, before any deduction.
 */
export function wallFaceArea(wall: Pick<WallInput, "lengthFt" | "heightFt">): SquareFeet {
  return wall.lengthFt * wall.heightFt;
}

/**
 * Area actually to be boarded, both sides, with large openings deducted.
 *
 * An opening is deducted on EVERY side the wall is boarded on — a door hole
 * goes through the wall, not through one face of it. Getting that wrong
 * halves the deduction and quietly overbids.
 */
export function boardedArea(
  wall: WallInput,
  options: { openingDeductionThresholdSqFt?: SquareFeet } = {},
): SquareFeet {
  const threshold =
    options.openingDeductionThresholdSqFt ?? DEFAULT_OPENING_DEDUCTION_THRESHOLD_SQFT;

  const deductiblePerFace = (wall.openings ?? [])
    .map((opening) => opening.widthFt * opening.heightFt)
    .filter((area) => area >= threshold)
    .reduce((sum, area) => sum + area, 0);

  const perFace = wallFaceArea(wall) - deductiblePerFace;
  // A wall that is mostly opening can compute negative. Zero is the honest
  // floor: it means there is nothing to board, not that the wall owes area.
  return Math.max(0, perFace) * wall.sides;
}

/**
 * Sheets needed, rounded UP, after waste.
 *
 * Rounded up because half a sheet cannot be bought. Waste is applied to the
 * area BEFORE rounding rather than to the sheet count after: applying it
 * after compounds the rounding, and on a small wall that is the difference
 * between one extra sheet and three.
 */
export function sheetsRequired(
  areaSqFt: SquareFeet,
  options: { wastePercent?: number; sheetAreaSqFt?: SquareFeet } = {},
): number {
  const waste = options.wastePercent ?? 10;
  const sheetArea = options.sheetAreaSqFt ?? DEFAULT_SHEET_AREA_SQFT;
  if (areaSqFt <= 0 || sheetArea <= 0) return 0;
  return Math.ceil((areaSqFt * (1 + waste / 100)) / sheetArea);
}

/**
 * Studs in a run, at spacing, including the one at each end.
 *
 * The `+ 1` is the stud most takeoffs forget: a 10 ft wall at 16" o.c. has
 * studs at 0, 16, 32… and one closing the far end. Dropping it underbids
 * every wall on the job by one stud, which is invisible per wall and
 * material across a floor plate.
 *
 * It does NOT add studs for corners, openings, or backing. Those depend on
 * the detail and on who is framing it, and inventing them here would be
 * guessing at somebody else's drawing.
 */
export function studsRequired(
  lengthFt: Feet,
  options: { spacingFt?: Feet } = {},
): number {
  const spacing = options.spacingFt ?? DEFAULT_STUD_SPACING_FT;
  if (lengthFt <= 0 || spacing <= 0) return 0;
  // CEIL, not floor. On a run that is not an exact multiple of the spacing,
  // the last full bay ends short of the wall and a stud still closes the
  // gap: a 10 ft wall at 16" o.c. has studs at 0,16,…,112 AND one at 120,
  // which is nine. floor gives eight. I shipped floor first, while the
  // docstring above already described the bug it caused — enumerating the
  // positions is what caught it, not reading the code.
  return Math.ceil(lengthFt / spacing) + 1;
}

/**
 * Track (runner) in linear feet: top and bottom of the run.
 *
 * No waste factor. Track is cut to length from stock lengths and the offcut
 * is usually usable, unlike board — a waste percentage here would be
 * inventing a loss that the shop does not actually take.
 */
export function trackRequired(lengthFt: Feet): Feet {
  return lengthFt <= 0 ? 0 : lengthFt * 2;
}

export type TakeoffLine = {
  label: string;
  quantity: number;
  unit: string;
};

/**
 * One wall, as the quantities a bid needs.
 *
 * Returned as lines rather than a single object so this maps straight onto
 * the existing JobLineItem shape — quantity and unit — without a second
 * translation step inventing its own vocabulary.
 */
export function takeoffWall(
  wall: WallInput,
  options: {
    wastePercent?: number;
    sheetAreaSqFt?: SquareFeet;
    spacingFt?: Feet;
    openingDeductionThresholdSqFt?: SquareFeet;
  } = {},
): TakeoffLine[] {
  const area = boardedArea(wall, options);
  return [
    { label: "Drywall area", quantity: round2(area), unit: "sq ft" },
    { label: "Drywall sheets", quantity: sheetsRequired(area, options), unit: "sheets" },
    { label: "Studs", quantity: studsRequired(wall.lengthFt, options), unit: "ea" },
    { label: "Track", quantity: round2(trackRequired(wall.lengthFt)), unit: "lin ft" },
  ];
}

/**
 * A ceiling, which is area and sheets only.
 *
 * Deliberately not grid, hangers or wire. An acoustical grid takeoff depends
 * on the tile module and the layout, and a number produced without the
 * reflected ceiling plan would be a guess wearing a quantity's clothes.
 */
export function takeoffCeiling(
  ceiling: { lengthFt: Feet; widthFt: Feet },
  options: { wastePercent?: number; sheetAreaSqFt?: SquareFeet } = {},
): TakeoffLine[] {
  const area = Math.max(0, ceiling.lengthFt * ceiling.widthFt);
  return [
    { label: "Ceiling area", quantity: round2(area), unit: "sq ft" },
    { label: "Drywall sheets", quantity: sheetsRequired(area, options), unit: "sheets" },
  ];
}

/** Two decimals, so a quantity reads like a quantity rather than like a
 * float. Counts are already integers and are unaffected. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
