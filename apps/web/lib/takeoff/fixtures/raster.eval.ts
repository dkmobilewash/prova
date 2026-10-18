import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { standardFontDir } from "../bench/run";
import { bitmapFromOpenPage } from "../rasterPage";
import { strokesFromBitmap } from "../rasterStrokes";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { readSheetScale } from "../scaleFromDimensions";
import { dimensionLabels } from "../../plan-ingest/dimensionLabels";
import { segmentsFromOpenPage } from "../sheetStrokes";
import type { SheetTextItem } from "../findWallsOnSheet";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── GRADING A SCAN AGAINST THE DRAWING IT IS A SCAN OF ──
 *
 *     pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/fixtures/raster.eval.ts
 *
 * The three scanned fixtures are rasters of three VECTOR fixtures already in
 * this repo. Each says so in its own title block, and the titles match the
 * keys exactly:
 *
 *   | scan | of  | title                      |
 *   | S18  | S02 | TWO-BEDROOM COTTAGE        |
 *   | S19  | S08 | FOUR-BEDROOM RESIDENCE     |
 *   | S20  | S13 | PROFESSIONAL OFFICE SUITE  |
 *
 * **So the answer key is free and it is not an opinion.** The vector sheet's
 * own strokes are what is on the paper; the question is how much of it the
 * detector gets back from the pixels. No new ground truth had to be written,
 * and nobody has to decide what a wall is to read this number — which is the
 * trap the rest of this fixture set spends its NOTES.md avoiding.
 *
 * **What this does NOT measure.** The three scans are clean rasterisations:
 * crisp lines, no skew, light speckle on S19 only. A photocopied, skewed,
 * 150-dpi fax of a plan is a harder problem and this says nothing about it. A
 * real image-only page from a real permit set was rendered and compared by eye
 * while writing this, and it is clean in the same way — so these fixtures are
 * a fair proxy for what we have actually seen, and not for the worst case.
 */

const DIR = join(import.meta.dirname, "plans");

/** Each scan and the drawing it was made from. */
const PAIRS = [
  { scan: "S18", vector: "S02" },
  { scan: "S19", vector: "S08" },
  { scan: "S20", vector: "S13" },
] as const;

/** How close a found line must be to a real one to count as the same line. */
const NEAR_PT = 3;
/** How much of the real line's length must be covered. */
const COVER = 0.6;
/** Below this there is no line worth scoring — the detector's own floor. */
const SCORE_FLOOR_PT = 14;

const horizontal = (s: StrokeSegment) => Math.abs(s.y2 - s.y1) < 0.5;
const vertical = (s: StrokeSegment) => Math.abs(s.x2 - s.x1) < 0.5;
const lengthOf = (s: StrokeSegment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** Is `found` the same line as `real`, allowing for a pixel grid? */
function sameLine(real: StrokeSegment, found: StrokeSegment): boolean {
  if (horizontal(real) !== horizontal(found) || vertical(real) !== vertical(found)) return false;
  const h = horizontal(real);
  const across = h ? Math.abs(found.y1 - real.y1) : Math.abs(found.x1 - real.x1);
  if (across > NEAR_PT) return false;
  const [r0, r1] = h ? [Math.min(real.x1, real.x2), Math.max(real.x1, real.x2)] : [Math.min(real.y1, real.y2), Math.max(real.y1, real.y2)];
  const [f0, f1] = h ? [Math.min(found.x1, found.x2), Math.max(found.x1, found.x2)] : [Math.min(found.y1, found.y2), Math.max(found.y1, found.y2)];
  const overlap = Math.min(r1, f1) - Math.max(r0, f0);
  return overlap / Math.max(1, r1 - r0) >= COVER;
}

describe.skipIf(!existsSync(DIR))("a scan against the drawing it is a scan of", () => {
  it("recovers the lines", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-expect-error pdfjs ships no types for the worker build; imported for its side effect.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

    const open = async (id: string) =>
      pdfjs.getDocument({
        data: new Uint8Array(readFileSync(join(DIR, `${id}.pdf`))),
        verbosity: 0,
        standardFontDataUrl: standardFontDir(),
      }).promise;

    const rows: string[] = [
      "",
      "scan  of    real  found  matched  missed  of those paired   ink%   unseen%  dpi",
    ];
    let totalReal = 0;
    let totalMatched = 0;
    let totalPaired = 0;

    for (const { scan, vector } of PAIRS) {
      const vdoc = await open(vector);
      const vpage = await vdoc.getPage(1);
      const truth = await segmentsFromOpenPage(vpage, pdfjs, 1);
      // THE CONTROL, and it comes before any score is read: a vector sheet
      // that yields nothing would make the detector look perfect at finding
      // nothing. `pathOperators` separates "a scan" from "a broken pipeline"
      // and `sheetStrokes` says so in its own header.
      expect(truth.pathOperators, `${vector} carried no path operators`).toBeGreaterThan(0);
      await vdoc.destroy();

      const real = truth.segments.filter(
        (s) => (horizontal(s) || vertical(s)) && lengthOf(s) >= SCORE_FLOOR_PT,
      );
      // The second half of the control. `pathOperators` proves the vector page
      // was READ; this proves it yielded lines worth grading against. A key of
      // zero lines would score any detector, including one that returns
      // nothing, at a clean 100%.
      expect(real.length, `${vector} yielded no scorable lines to grade ${scan} against`).toBeGreaterThan(0);

      const sdoc = await open(scan);
      const spage = await sdoc.getPage(1);
      const bitmap = await bitmapFromOpenPage(spage, sdoc);
      const got = strokesFromBitmap(bitmap, { dpi: bitmap.dpi });
      await sdoc.destroy();

      const missedLines = real.filter((r) => !got.segments.some((f) => sameLine(r, f)));
      const matched = real.length - missedLines.length;
      totalReal += real.length;
      totalMatched += matched;

      // ── WHY A MISS MAY NOT BE A MISS ──
      //
      // A vector drawing gives a thick wall as TWO lines, one per face. A
      // bitmap gives it as one band, and this detector reports that band's
      // CENTRELINE. So a wall that was found perfectly still scores one hit
      // and one miss, by construction, and the score would read as a detector
      // problem when it is a representation difference.
      //
      // Counted rather than argued: a missed line with a parallel neighbour a
      // wall's thickness away is the second face of a pair.
      const paired = missedLines.filter((m) => {
        const h = horizontal(m);
        return real.some((o) => {
          if (o === m || horizontal(o) !== h) return false;
          const apart = h ? Math.abs(o.y1 - m.y1) : Math.abs(o.x1 - m.x1);
          if (apart < 0.5 || apart > 12) return false;
          const [a0, a1] = h ? [Math.min(m.x1, m.x2), Math.max(m.x1, m.x2)] : [Math.min(m.y1, m.y2), Math.max(m.y1, m.y2)];
          const [b0, b1] = h ? [Math.min(o.x1, o.x2), Math.max(o.x1, o.x2)] : [Math.min(o.y1, o.y2), Math.max(o.y1, o.y2)];
          return Math.min(a1, b1) - Math.max(a0, b0) > 0;
        });
      }).length;
      totalPaired += paired;

      rows.push(
        `${scan}   ${vector}  ${String(real.length).padStart(4)}  ${String(got.segments.length).padStart(5)}  ` +
          `${String(matched).padStart(7)}  ${String(missedLines.length).padStart(6)}  ${String(paired).padStart(14)}  ` +
          `${(got.darkFraction * 100).toFixed(1).padStart(5)}  ${(got.diagonalInk * 100).toFixed(0).padStart(7)}  ` +
          `${bitmap.dpi.toFixed(0)}`,
      );
    }

    // ── AND THE ONLY COMPARISON THAT ANSWERS THE QUESTION ASKED ──
    //
    // The line score above is a stroke-level diagnostic and it UNDERSTATES by
    // construction: a vector drawing gives a thick wall two faces, a bitmap
    // gives it one centreline, so a wall found perfectly scores one hit and
    // one miss. Nobody is buying strokes. What matters is whether the walls
    // and the footage come out the same.
    //
    // So this runs the REAL wall detection twice over the same drawing and
    // changes exactly one thing: where the segments came from. The text, the
    // scale, the page size and the wall types are all the vector sheet's own,
    // because the scan has no text layer at all — reading ITS words is the
    // other half of this problem and must not be confounded with this half.
    const wallRows: string[] = ["", "scan  of    vector walls / ft      raster walls / ft     footage"];
    for (const { scan, vector } of PAIRS) {
      const vdoc = await open(vector);
      const vpage = await vdoc.getPage(1);
      const truth = await segmentsFromOpenPage(vpage, pdfjs, 1);
      const raw = await vpage.getTextContent();
      type RawItem = { str?: string; transform?: number[]; width?: number; height?: number };
      const items: SheetTextItem[] = (raw.items as RawItem[])
        .filter((i): i is Required<RawItem> => typeof i.str === "string" && i.str.trim().length > 0 && Array.isArray(i.transform))
        .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width, height: i.height }));
      await vdoc.destroy();

      const page = { pageNumber: 1, widthPt: truth.widthPt, heightPt: truth.heightPt, rotation: 0, items };
      const verdict = readSheetScale(page, truth.segments, dimensionLabels(page));
      if (!verdict.ok) {
        wallRows.push(`${scan}   ${vector}  no scale on the vector original — not graded`);
        continue;
      }
      const feetPerUnit = (truth.widthPt / 72) * verdict.feetPerInch;

      const sdoc = await open(scan);
      const spage = await sdoc.getPage(1);
      const bitmap = await bitmapFromOpenPage(spage, sdoc);
      const rasterSegments = strokesFromBitmap(bitmap, { dpi: bitmap.dpi }).segments;
      await sdoc.destroy();

      const run = (segments: readonly StrokeSegment[]) =>
        findWallsOnSheet({
          segments: segments as StrokeSegment[],
          textItems: items,
          pageSize: { widthPt: truth.widthPt, heightPt: truth.heightPt },
          feetPerUnit,
          wallTypes: [],
          sampledSheets: null,
        }).inBuilding;

      const v = run(truth.segments);
      const r = run(rasterSegments);
      const vft = v.reduce((n, w) => n + w.lengthFeet, 0);
      const rft = r.reduce((n, w) => n + w.lengthFeet, 0);
      wallRows.push(
        `${scan}   ${vector}  ${String(v.length).padStart(5)} / ${vft.toFixed(0).padStart(6)}      ` +
          `${String(r.length).padStart(5)} / ${rft.toFixed(0).padStart(6)}     ` +
          `${vft > 0 ? ((rft / vft) * 100).toFixed(0) + "%" : "n/a"}`,
      );
    }
    rows.push(...wallRows);

    rows.push("");
    rows.push(`RECOVERED: ${totalMatched} of ${totalReal} real lines (${((totalMatched / totalReal) * 100).toFixed(0)}%)`);
    rows.push(`of the ${totalReal - totalMatched} missed, ${totalPaired} are the second face of a parallel pair`);
    console.log(rows.join("\n"));
    expect(totalReal, "no vector lines to grade against").toBeGreaterThan(0);
  }, 900_000);
});
