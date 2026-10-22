import type { SheetTextItem } from "@/lib/takeoff/findWallsOnSheet";
import { sheetViews, viewRegions, viewsInRegions, viewsWithOwnScale } from "@/lib/takeoff/sheetViews";
import type { StrokeSegment } from "@/lib/takeoff/wallVectors";

/**
 * ── ONE PLACE DECIDES WHAT SCALE A SHEET IS AT ──
 *
 * The app and the real-plan report both answer this question, and for weeks
 * they answered it differently. The report ran `readSheetScale` and stopped;
 * the app ran `readSheetScale` and then fell back to the PRINTED scale. So four
 * real sheets were reported as "no scale" that the app reads perfectly, and the
 * measure understated the product it was supposed to be measuring.
 *
 * That is not a reporting bug to be patched in the report. Two implementations
 * of one decision will drift again the moment either is improved, and the next
 * disagreement will be discovered the same way — by somebody noticing two
 * numbers that cannot both be right. So the decision lives here, both callers
 * use it, and `sheetScaleParity.test.ts` fails if either stops.
 *
 * ── THE ORDER IS THE PRODUCT RULE, NOT A PREFERENCE ──
 *
 * 1. DIMENSIONS. A figure printed on the drawing, with the line it came from.
 *    An estimator can see the line sitting on `16' - 4 1/2"` and check it in
 *    two seconds. Nothing else here can be checked that way.
 * 2. PRINTED. The scale the architect typed in the title block. Nothing on the
 *    sheet confirms it, so it is marked unverified and never overrules a
 *    dimension — `scaleFromPrinted` also refuses a page carrying MORE THAN ONE
 *    printed scale, because it cannot tell which drawing each belongs to.
 * 3. VIEWS. Which is exactly the case step 2 refuses: a sheet with several
 *    drawings at several scales. Each view's caption is read against the
 *    region that view occupies, so the scales are not in competition — they
 *    are answers to different questions. A caption is feet per PAPER INCH and
 *    therefore absolute, needing no anchor from elsewhere on the sheet.
 * 4. Nothing, with the reason in words.
 *
 * Step 3 is last because a caption is the weakest evidence of the three: it is
 * wrong whenever somebody rescales a detail and does not retype it.
 */

/** One drawing on a sheet, and the scale captioned under it. */
export type ViewScale = {
  /** The caption above the scale — "FLOOR PLAN", "ENLARGED BATH PLAN". */
  name: string;
  /** As the drawing prints it: `1/8" = 1'-0"`. */
  scaleName: string;
  /** Feet per paper inch, which is absolute and needs no anchor. */
  feetPerInch: number;
  /** The part of the page this drawing occupies, in page-WIDTH units. */
  from: number;
  to: number;
  fromY: number;
  toY: number;
};

export type SheetScale =
  | { kind: "DIMENSIONS"; scaleName: string; feetPerInch: number }
  | { kind: "PRINTED"; scaleName: string; feetPerInch: number }
  | { kind: "VIEWS"; views: ViewScale[] }
  | { kind: "NONE"; reason: string };

export type SheetScaleInput = {
  /** Every word on the sheet, in points — `planPdf`'s own shape. */
  textItems: readonly SheetTextItem[];
  /** Every stroked segment, in points. */
  segments: readonly StrokeSegment[];
  pageSize: { widthPt: number; heightPt: number };
  /**
   * What the two earlier steps decided, passed in rather than recomputed.
   *
   * `readSheetScale` and `scaleFromPrinted` both need inputs this module has no
   * business assembling — a `TextContent` shape, dimension labels, the metric
   * pass. Taking their ANSWERS keeps this function about the ORDER, which is
   * the thing that was drifting, and keeps it testable without a PDF.
   */
  fromDimensions: { ok: true; scaleName: string; feetPerInch: number } | { ok: false; reason: string };
  fromPrinted: { scaleName: string; feetPerInch: number } | null;
};

export function sheetScale(input: SheetScaleInput): SheetScale {
  if (input.fromDimensions.ok) {
    return {
      kind: "DIMENSIONS",
      scaleName: input.fromDimensions.scaleName,
      feetPerInch: input.fromDimensions.feetPerInch,
    };
  }
  if (input.fromPrinted !== null) {
    return {
      kind: "PRINTED",
      scaleName: input.fromPrinted.scaleName,
      feetPerInch: input.fromPrinted.feetPerInch,
    };
  }

  const views = viewsWithOwnScale(
    viewsInRegions(
      sheetViews(input.textItems, input.pageSize.widthPt),
      viewRegions(input.segments, input.pageSize),
    ),
    input.pageSize.widthPt,
  );
  // A VIEW WITH NO GEOMETRY IN IT IS NOT A DRAWING. `viewsInRegions` gives a
  // caption its region from the sheet's own gutters, and a caption sitting over
  // empty paper — a legend, a note block — gets one too.
  const drawn = views.filter(({ view }) =>
    input.segments.some((one) => {
      const mx = (one.x1 + one.x2) / 2 / input.pageSize.widthPt;
      const my = (one.y1 + one.y2) / 2 / input.pageSize.widthPt;
      return mx >= view.from && mx < view.to && my >= view.fromY && my < view.toY;
    }),
  );
  if (drawn.length > 0) {
    return {
      kind: "VIEWS",
      views: drawn.map(({ view }) => ({
        name: view.name,
        // Both are non-null by construction: `viewsWithOwnScale` drops a view
        // whose caption names no scale, which is what NTS and AS NOTED produce.
        scaleName: view.scaleName ?? "",
        feetPerInch: view.feetPerInch ?? 0,
        from: view.from,
        to: view.to,
        fromY: view.fromY,
        toY: view.toY,
      })),
    };
  }

  return { kind: "NONE", reason: input.fromDimensions.reason };
}

/**
 * Feet per page-WIDTH unit, which is what every measurement downstream wants.
 *
 * The conversion is one line and it is here so that no caller writes it again:
 * getting `widthPt / 72` the wrong way round produces a number 5,184 times out
 * and nothing throws, which is the shape of the harness bug recorded in
 * AUDIT.md.
 */
export function feetPerUnitFrom(feetPerInch: number, widthPt: number): number {
  return (widthPt / 72) * feetPerInch;
}

/** What gets stored on the scale reading, and read back by the workspace. */
export type StoredViewScales = { views: ViewScale[] };

/**
 * Reads the JSON column back, refusing anything that is not the shape it
 * wrote.
 *
 * A stored blob is data from another build, and a build that half-understands
 * it is worse than one that declines: a view with a missing region would be
 * measured over the whole sheet at a detail's scale, which is the "hundreds of
 * feet that are not a building" failure `sheetViews` was written for.
 */
export function viewScalesFromJson(value: unknown): ViewScale[] {
  if (value === null || typeof value !== "object") return [];
  const views = (value as { views?: unknown }).views;
  if (!Array.isArray(views)) return [];
  const out: ViewScale[] = [];
  for (const one of views) {
    if (one === null || typeof one !== "object") return [];
    const v = one as Record<string, unknown>;
    if (typeof v.name !== "string" || typeof v.scaleName !== "string") return [];
    const numbers = ["feetPerInch", "from", "to", "fromY", "toY"] as const;
    if (numbers.some((key) => typeof v[key] !== "number" || !Number.isFinite(v[key] as number))) {
      return [];
    }
    if ((v.feetPerInch as number) <= 0) return [];
    out.push({
      name: v.name,
      scaleName: v.scaleName,
      feetPerInch: v.feetPerInch as number,
      from: v.from as number,
      to: v.to as number,
      fromY: v.fromY as number,
      toY: v.toY as number,
    });
  }
  return out;
}

/**
 * The calibration line to propose for one view, in page-WIDTH units.
 *
 * ── THE VIEW'S OWN WIDTH, FOR THE REASON `scaleFromPrinted` USES THE SHEET'S ──
 *
 * A caption gives a RATIO and not a distance, so the line has to come from
 * somewhere. The widest thing the ratio is certainly true about is the view's
 * own region: the drawing occupies it, and the caption is that drawing's. At a
 * span of nearly the whole view it is the longest line available and therefore
 * the least sensitive to a pixel either way — the same argument that makes a
 * long calibration an accurate one.
 *
 * It INVENTS NO DIMENSION. Both numbers are facts: the region is measured from
 * the sheet's own gutters, and the feet are what the printed caption says that
 * region spans. Nothing is read off a dimension that is not there.
 *
 * Drawn across the MIDDLE of the view's height, so it sits over the drawing
 * rather than along its edge where a reviewer might miss it.
 */
export function calibrationForView(
  view: ViewScale,
  widthPt: number,
): { x1: number; y1: number; x2: number; y2: number; declaredDistanceFeet: number } {
  const feetPerUnit = feetPerUnitFrom(view.feetPerInch, widthPt);
  // Inset a little, so the line is visibly INSIDE the drawing it measures and
  // cannot be read as the gutter between two of them.
  const inset = (view.to - view.from) * 0.05;
  const x1 = view.from + inset;
  const x2 = view.to - inset;
  const y = (view.fromY + view.toY) / 2;
  return {
    x1,
    y1: y,
    x2,
    y2: y,
    declaredDistanceFeet: (x2 - x1) * feetPerUnit,
  };
}
