import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../plan-ingest/planPdf";
import {
  sheetViews,
  wallsPerView,
  primaryView,
  withDimensionScale,
  viewRegions,
  viewsInRegions,
} from "./sheetViews";
import { readSheetScale } from "./scaleFromDimensions";
import { dimensionLabels } from "../plan-ingest/dimensionLabels";
import type { StrokeSegment } from "./wallVectors";
import type { SheetTextItem } from "./findWallsOnSheet";

/**
 * ── EVERY SHEET IN THE SET, SPLIT INTO ITS VIEWS ──
 *
 *     pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/sheetViews.eval.ts
 *
 * Calls no model and needs no key. It opens the fixture PDFs, so it skips
 * where they are absent rather than passing on nothing.
 */
const PLANS = join(import.meta.dirname, "fixtures/plans");

describe.skipIf(!existsSync(PLANS))("the views on each sheet", () => {
  it("names them, bands them, and measures each at its own scale", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `S${String(i + 1).padStart(2, "0")}`);
    const rows: string[] = ["", "id    views  name / scale / band / measured"];
    const opened: string[] = [];
    const multiView: string[] = [];

    for (const id of ids) {
      const file = join(PLANS, `${id}.pdf`);
      if (!existsSync(file)) continue;
      const doc = await openPlanPdf(readFileSync(file));
      try {
        const text = await doc.pageText(1);
        const strokes = await doc.pageStrokes(1);
        opened.push(id);
        let views = sheetViews(text.items, strokes.widthPt);
        // THE MEASURED SCALE BEATS THE CAPTION, for the view it was measured
        // in — see `withDimensionScale`. Without this S11 reports 141 ft off a
        // caption its own dimensions contradict.
        // THE REGIONS COME FROM THE GEOMETRY, not from where a caption sits.
        views = viewsInRegions(views, viewRegions(strokes.segments as StrokeSegment[], {
          widthPt: strokes.widthPt,
          heightPt: strokes.heightPt,
        }));
        // ── REGIONS FIRST, THEN THE MEASURED SCALE. ORDER IS LOAD-BEARING ──
        //
        // `withDimensionScale` replaces the caption for the view the dimension
        // line sits IN. Run before the regions are known every view still
        // claims the whole page, so the test is true for all of them and the
        // enlarged detail is handed the plan's scale — which is the defect this
        // file exists to remove, reintroduced by doing two right things in the
        // wrong order. S15's bath read 1/4" and 6 ft that way.
        const verdict = readSheetScale(text, strokes.segments, dimensionLabels(text), {});
        if (verdict.ok) {
          views = withDimensionScale(views, {
            feetPerInch: verdict.feetPerInch,
            scaleName: verdict.scaleName,
            atX: (verdict.best.x1 + verdict.best.x2) / 2 / strokes.widthPt,
            atY: (verdict.best.y1 + verdict.best.y2) / 2 / strokes.widthPt,
          });
        }
        if (views.length > 1) multiView.push(id);
        rows.push(`${id.padEnd(5)} ${String(views.length).padStart(5)}`);
        if (views.length === 0) continue;

        const items: SheetTextItem[] = text.items.map((i) => ({
          str: i.str,
          x: i.x,
          y: i.y,
          width: i.width,
          height: i.height,
        }));
        const measured = wallsPerView({
          segments: strokes.segments as StrokeSegment[],
          textItems: items,
          pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
          views,
          wallTypes: [],
          // What the sheet's own dimensions voted, which is what the app
          // trusts — the captions are used only as a ratio against it.
          feetPerUnit: verdict.ok ? (text.widthPt / 72) * verdict.feetPerInch : 0,
        });
        const { primary } = primaryView(measured);
        for (const m of measured) {
          const mark = m === primary ? "*" : " ";
          rows.push(
            `    ${mark} ${m.view.name.padEnd(22)} ${(m.view.scaleName ?? "NOT A SCALE").padEnd(14)} ` +
              `x ${(m.view.from * 100).toFixed(0)}..${(m.view.to * 100).toFixed(0)} y ${(m.view.fromY * 100).toFixed(0)}..${(m.view.toY * 100).toFixed(0)}`.padEnd(22) +
              `  ${m.walls.length} runs  ${m.lengthFeet.toFixed(0)} ft`,
          );
        }
      } finally {
        await doc.close();
      }
    }

    console.log(rows.join("\n"));
    // THE EVAL REALLY RAN. A clean table of zeroes is what "no fixture opened"
    // looks like, and it is indistinguishable from "no sheet has views".
    expect(opened.length, "no fixture PDF was opened — this eval scored nothing").toBeGreaterThan(0);
    // AND THE SPLIT ACTUALLY HAPPENED. Every sheet reading as single-view is
    // exactly what a broken caption reader looks like, and it would print a
    // tidy table and pass.
    expect(
      multiView.length,
      "no sheet read as multi-view, and S15 is one — the caption reader found nothing",
    ).toBeGreaterThan(0);
  }, 300_000);
});
