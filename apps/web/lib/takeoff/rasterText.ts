import type { SheetTextItem } from "./findWallsOnSheet";

/**
 * ── THE WORDS ON A SCANNED SHEET, AS ORDINARY TEXT ITEMS ──
 *
 * The companion to `rasterStrokes.ts`, and the same shape of idea: a scan is
 * turned into exactly what a vector page produces, so nothing downstream has
 * to learn that scans exist. `rasterStrokes` returns `StrokeSegment`s; this
 * returns `SheetTextItem`s, which is what `printedScalesOnPage`,
 * `dimensionLabels`, the room reader and the lettering filter all consume.
 *
 * **The division of labour is ARCHITECTURE.md's, unchanged.** The model reads
 * what the ink SAYS and roughly where it sits — interpretation. Every length,
 * area and quantity is still measured by code from the geometry. A dimension
 * string's value comes from here; the line it belongs to is measured by
 * `rasterStrokes`; the scale is their quotient, computed in
 * `scaleFromDimensions`. No number a customer is billed from leaves a model.
 *
 * **The tiling LOOP is not here, and that is deliberate.** It lives where the
 * gate is: `lib/actions/takeoffReadSheet.ts` reads one tile, behind the
 * company's AI switch and its allowance, and the viewer walks the grid one
 * tile at a time. A convenience wrapper here that read a whole page would be a
 * second path to the model with no gate on it — `aiFeatureGateCensus` fails
 * the build for exactly that, and it caught this file doing it.
 *
 * What is left is the arithmetic, which is pure and testable without a model.
 *
 * **Tiled, which is what makes the coordinates usable.** Measured on the
 * scanned fixtures against the vector drawings they are rasters of: every
 * printed string read exactly, and 98% of them placed within the 30 points
 * `scaleFromDimensions` allows between a label and its line. A whole sheet
 * sent in one image is a thumbnail by the time the model sees it.
 */

/** The side of one tile, in points. */
export const TILE_PT = 600;
/**
 * Pixels across a rendered tile.
 *
 * 1600 over a 600-point tile is about 190 dpi, which is the figure that made
 * the wall classifier legible when the same pixel budget spread over a whole
 * ARCH D sheet was not — a 36-inch sheet at 1600px is 44 dpi, and nobody can
 * read a dimension string at 44 dpi, model or person.
 */
export const TILE_PX = 1600;

/**
 * One tile-relative box, as a page-space `SheetTextItem`.
 *
 * SEPARATE AND EXPORTED so the arithmetic can be tested without a model —
 * which matters more here than it looks: an error in this one function moves
 * every word on the sheet, and the symptom is a scale that will not read
 * rather than anything that names a coordinate.
 *
 * `SheetTextItem` carries the BASELINE y, the way pdfjs reports a vector
 * page's text, because `findWallsOnSheet` shifts from baseline itself through
 * its own `fromBaseline`. The model gives a box top, so the baseline is the
 * box's BOTTOM — handing back the top instead would raise every word by its
 * own height and is exactly the kind of mistake that still looks plausible.
 */
export function tileBoxToSheetItem(
  box: { text: string; x: number; y: number; width: number; height: number },
  tileX: number,
  tileY: number,
  tilePt: number = TILE_PT,
): SheetTextItem {
  return {
    str: box.text,
    x: tileX * tilePt + box.x * tilePt,
    y: tileY * tilePt + (box.y + box.height) * tilePt,
    width: box.width * tilePt,
    height: box.height * tilePt,
  };
}
