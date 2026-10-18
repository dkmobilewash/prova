import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetViews, viewRegions, viewsInRegions, wallsPerView, primaryView } from "../sheetViews";
import { findWallsOnSheet } from "../findWallsOnSheet";
import type { StrokeSegment } from "../wallVectors";
import type { SheetTextItem } from "../findWallsOnSheet";

const PDFS = join(import.meta.dirname, "../../../../../reports/takeoff-bench/fixtures/pdf");

/**
 * ── THE ONLY MULTI-VIEW SHEET IN THIS REPO WITH GROUND TRUTH ──
 *
 *     pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/fixtures/benchMultiView.eval.ts
 *
 * The 20-sheet fixture set scores SCALE and prints no wall length, so S15 can
 * show that a sheet splits and cannot say whether the pieces are right.
 * `reports/takeoff-bench` has per-wall truth, and A-401 carries two drawings
 * at two scales plus a third at NTS — which is how the NTS rule in
 * `sheetViews.ts` was found at all.
 *
 * It prints the baseline beside the split deliberately. The quoted figure is
 * essentially unchanged (678 ft against 679), and what changes is that the
 * stair is identified at ITS OWN 1/2in instead of disappearing into the sheet.
 * The over-reporting against the key — 679 where the truth is 266 — is the
 * wall finder's accuracy on a detail sheet and is PRE-EXISTING: the baseline
 * has the same error, which is the whole reason both numbers are printed.
 */
describe.skipIf(!existsSync(PDFS))("the bench's own multi-view sheet", () => {
  it("splits A-401 and measures each view", async () => {
    const files = readdirSync(PDFS).filter((f) => f.startsWith("A-401__") && f.endsWith(".pdf"));
    const rows: string[] = [""];
    for (const file of files.slice(0, 6)) {
      const doc = await openPlanPdf(readFileSync(join(PDFS, file)));
      try {
        const text = await doc.pageText(1);
        const strokes = await doc.pageStrokes(1);
        const pageSize = { widthPt: strokes.widthPt, heightPt: strokes.heightPt };
        const regions = viewRegions(strokes.segments as StrokeSegment[], pageSize);
        const views = viewsInRegions(sheetViews(text.items, strokes.widthPt), regions);
        rows.push(`${file}  ${strokes.widthPt}x${strokes.heightPt}  regions=${regions.length}  views=${views.length}`);
        if (views.length === 0) continue;
        const items: SheetTextItem[] = text.items.map((i) => ({
          str: i.str, x: i.x, y: i.y, width: i.width, height: i.height,
        }));
        const measured = wallsPerView({
          segments: strokes.segments as StrokeSegment[],
          textItems: items,
          pageSize,
          views,
          wallTypes: [],
          // 1/4" on an ARCH D sheet, which is the restroom plan's own scale.
          feetPerUnit: (strokes.widthPt / 72) * 4,
        });
        // THE BASELINE: the whole sheet at one scale, which is what ships.
        const base = findWallsOnSheet({
          segments: strokes.segments as StrokeSegment[],
          textItems: items,
          pageSize,
          feetPerUnit: (strokes.widthPt / 72) * 4,
          wallTypes: [],
          sampledSheets: null,
        });
        rows.push(`     BASELINE whole sheet at 1/4": ${base.walls.length} runs, ${base.walls.reduce((n, w) => n + w.lengthFeet, 0).toFixed(0)} ft`);
        const { primary } = primaryView(measured);
        for (const m of measured) {
          rows.push(
            `     ${m === primary ? "*" : " "} ${m.view.name.padEnd(26)} ${(m.view.scaleName ?? "NTS - not measured").padEnd(18)} ` +
              `x ${(m.view.from * 100).toFixed(0)}..${(m.view.to * 100).toFixed(0)} ` +
              `y ${(m.view.fromY * 100).toFixed(0)}..${(m.view.toY * 100).toFixed(0)}  ` +
              `${m.walls.length} runs  ${m.lengthFeet.toFixed(0)} ft`,
          );
        }
      } finally {
        await doc.close();
      }
    }
    console.log(rows.join("\n"));
    expect(files.length, "no A-401 PDF was found").toBeGreaterThan(0);
  }, 300_000);
});
