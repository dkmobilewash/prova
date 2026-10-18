import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { dimensionLabels, metricDimensionLabels } from "../../plan-ingest/dimensionLabels";
import { readSheetScale } from "../scaleFromDimensions";
import { findWallsOnSheet, type SheetTextItem } from "../findWallsOnSheet";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── THE SAME BUILDING AT TWO SCALES MUST MEASURE THE SAME ──
 *
 * S02 and S03 are one building drawn twice: 240 ft of wall, nine walls, the
 * same 4-1/2in and 6-1/2in assemblies, the same eleven openings. S02 is
 * 1/4" = 1'-0" on ARCH C at 18 pt/ft; S03 is 1/8" on ANSI B at 9 pt/ft. Every
 * wall on S03 is half as thick on paper as the same wall on S02.
 *
 * So any threshold the engine applies in PAPER units, or any quantity whose
 * value in feet depends on the scale, shows up here as a disagreement between
 * two numbers that describe the same building. That is a kind of error no
 * single-scale fixture set can see, and the 60-page bench key is entirely
 * 1/8" — which is exactly how a raw face-length ratio sat in `wallFromPair`
 * for months with a measured sweep saying it cost nothing.
 *
 * WHAT IT CAUGHT, and the reason this file exists rather than a note:
 *
 *   - a dimension extension line is a fixed length on PAPER, so it is twice
 *     as many feet at 1/8" as at 1/4". `oneFacePerLine` merges it into the
 *     wall face it is collinear with, and the merged face was then 9.52 ft on
 *     S03 against 5.89 ft on S02 — against a 1.73 ft partner either way.
 *     The old rule 5 refused one and accepted the other, for 2 ft of a 40 ft
 *     wall's southwest corner.
 *
 * The bound is 0.5%, which is tighter than the +/-2% the sheets are scored to
 * and loose enough for the honest difference between two rasterisations of
 * one drawing. It is NOT zero: the two PDFs are separate files with their own
 * rounding, so demanding equality would be a test about floating point.
 */

const PLANS = join(import.meta.dirname, "plans");

const BOUND = 0.005;

async function readSheet(id: string): Promise<{ feet: number; runs: readonly unknown[] }> {
  const doc = await openPlanPdf(readFileSync(join(PLANS, `${id}.pdf`)));
  try {
    const text = await doc.pageText(1);
    const strokes = await doc.pageStrokes(1);
    const verdict = readSheetScale(
      text,
      strokes.segments,
      dimensionLabels(text),
      {},
      metricDimensionLabels(text),
    );
    if (!verdict.ok) throw new Error(`${id}: no scale, so this test cannot say anything`);
    const items: SheetTextItem[] = text.items.map((i) => ({
      str: i.str,
      x: i.x,
      y: i.y,
      width: i.width,
      height: i.height,
    }));
    const found = findWallsOnSheet({
      segments: strokes.segments as StrokeSegment[],
      textItems: items,
      pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
      feetPerUnit: (text.widthPt / 72) * verdict.feetPerInch,
      wallTypes: [],
      sampledSheets: null,
    });
    return {
      feet: found.walls.reduce((total, wall) => total + wall.lengthFeet, 0),
      runs: found.walls,
    };
  } finally {
    await doc.close();
  }
}

describe.skipIf(!existsSync(PLANS))("one building, two scales", () => {
  it("measures S02 and S03 within 0.5% of each other", async () => {
    const quarter = await readSheet("S02");
    const eighth = await readSheet("S03");

    // ZERO AGREES WITH ZERO PERFECTLY, so the comparison below is worthless
    // until both sheets are known to have been read. Two assertions, because
    // they fail for different reasons: no runs at all means the sheet never
    // reached the pairer, and a plausible run count with half the footage
    // means it did and lost most of it.
    expect(quarter.runs.length, "S02 produced no runs at all").toBeGreaterThan(0);
    expect(eighth.runs.length, "S03 produced no runs at all").toBeGreaterThan(0);
    const quarterInch = quarter.feet;
    const eighthInch = eighth.feet;
    expect(quarterInch, "S02 found almost nothing").toBeGreaterThan(120);
    expect(eighthInch, "S03 found almost nothing").toBeGreaterThan(120);

    const spread = Math.abs(quarterInch - eighthInch) / Math.max(quarterInch, eighthInch);
    expect(
      spread,
      `S02 read ${quarterInch.toFixed(1)} ft and S03 read ${eighthInch.toFixed(1)} ft — ` +
        `${(spread * 100).toFixed(2)}% apart on the same building. Something in the ` +
        `engine is measured in paper units; see this file's header.`,
    ).toBeLessThan(BOUND);
  }, 180_000);
});
