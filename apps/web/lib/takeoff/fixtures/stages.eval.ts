import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { dimensionLabels, metricDimensionLabels } from "../../plan-ingest/dimensionLabels";
import { readSheetScale } from "../scaleFromDimensions";
import { findWallsOnSheet, type SheetTextItem } from "../findWallsOnSheet";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── WHICH STAGE DROPPED THE WALLS ──
 *
 *     SHEETS=S06,S10 pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/fixtures/stages.eval.ts
 *
 * The scorecard says a sheet produced nothing; this says which filter ate it.
 * It is the question that comes up every time, and answering it by reasoning
 * has already been wrong once: S06's overlay shows its walls drawn as filled
 * poche, which is a convincing explanation for "the pairer found nothing" and
 * is NOT what happened. The pairer found nine candidates and
 * `wallsInTheBuilding` discarded all nine for being fewer than `NOT_A_BOX`.
 *
 * Every column is a stage of `findWallsOnSheet`, in the order they run.
 */

const IDS = (process.env.SHEETS ?? "S02,S06,S10,S15").split(",");

describe.skipIf(!existsSync(join(import.meta.dirname, "plans")))("where the walls go", () => {
  it("counts every stage", async () => {
    const rows = ["", "id    segs  everywhere  inBuilding  notLettering  notBorder  walls  groups"];
    /** Segment counts actually read, so the controls below can prove it. */
    const read: number[] = [];
    for (const id of IDS) {
      const doc = await openPlanPdf(readFileSync(join(import.meta.dirname, "plans", `${id}.pdf`)));
      try {
        const text = await doc.pageText(1);
        const strokes = await doc.pageStrokes(1);
        read.push(strokes.segments.length);
        const verdict = readSheetScale(text, strokes.segments, dimensionLabels(text), {}, metricDimensionLabels(text));
        if (!verdict.ok) {
          rows.push(`${id.padEnd(5)} ${String(strokes.segments.length).padStart(5)}   (no scale)`);
          continue;
        }
        const items: SheetTextItem[] = text.items.map((i) => ({
          str: i.str, x: i.x, y: i.y, width: i.width, height: i.height,
        }));
        const f = findWallsOnSheet({
          segments: strokes.segments as StrokeSegment[],
          textItems: items,
          pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
          feetPerUnit: (text.widthPt / 72) * verdict.feetPerInch,
          wallTypes: [],
          sampledSheets: null,
        });
        const g = f.inBuilding;
        const xs = g.flatMap((w) => [w.x1, w.x2]);
        const ys = g.flatMap((w) => [w.y1, w.y2]);
        const bw = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
        const bh = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
        const ft = g.reduce((n, w) => n + w.lengthFeet, 0);
        rows.push(
          `${id.padEnd(5)} ${String(strokes.segments.length).padStart(5)} ${String(f.everywhere.length).padStart(11)}` +
            ` ${String(f.inBuilding.length).padStart(11)} ${String(f.notLettering.length).padStart(13)}` +
            ` ${String(f.notBorder.length).padStart(10)} ${String(f.walls.length).padStart(6)} ${String(f.groups.length).padStart(7)}` +
            `   bbox ${(bw * 100).toFixed(0)}%x${(bh * 100).toFixed(0)}%  ${ft.toFixed(0)}ft`,
        );
      } finally {
        await doc.close();
      }
    }
    console.log(rows.join("\n"));
    // The input really resolved: a run that opened no fixture, or read no
    // geometry from any of them, must not print a clean table of zeroes —
    // which is exactly what "this sheet found no walls" looks like.
    expect(read.length, "no fixture was opened").toBeGreaterThan(0);
    expect(
      read.reduce((n, r) => n + r, 0),
      "no geometry was read from any sheet — the reader, not the drawings",
    ).toBeGreaterThan(0);
  }, 300_000);
});
