import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { dimensionLabels, metricDimensionLabels } from "../../plan-ingest/dimensionLabels";
import { readSheetScale } from "../scaleFromDimensions";
import { buildingGroups } from "../wallVectors";
import { findWallsOnSheet, type SheetTextItem } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── WHAT THE BIGGEST GROUP LOOKS LIKE, BEFORE ANYTHING JUDGES IT ──
 *
 *     pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/fixtures/groups.eval.ts
 *
 * `wallsInTheBuilding` keeps the biggest connected group and then throws it
 * away if it has fewer than `NOT_A_BOX` runs. That count is standing in for a
 * question it cannot actually ask — *is this a building or is it the title
 * block?* — and it answers wrongly in both directions:
 *
 *   - a ONE-ROOM building is four runs and is discarded (S01);
 *   - a title block is four runs and would be kept if it were ever the
 *     biggest, which on a sheet with no plan on it, it is.
 *
 * This prints the measurements a replacement rule could use, for every
 * fixture, with no threshold applied. The point is to choose the rule from
 * the numbers rather than to guess one and tune it.
 */

const DIR = join(import.meta.dirname, "plans");

describe.skipIf(!existsSync(DIR))("the biggest group, unjudged", () => {
  it("measures it on every fixture", async () => {
    const ids = readdirSync(DIR).filter((f) => f.endsWith(".pdf")).map((f) => f.replace(".pdf", "")).sort();
    expect(ids.length, "no fixtures found").toBeGreaterThan(0);

    const rows = ["", "id    runs    feet   bbox w%  bbox h%   area%   sheet"];
    for (const id of ids) {
      const bytes = readFileSync(join(DIR, `${id}.pdf`));
      const strokes = await sheetStrokes(bytes, 1);
      const pdf = await openPlanPdf(bytes);
      const page = await pdf.pageText(1);
      await pdf.close();

      const verdict = readSheetScale(
        page,
        strokes.segments,
        dimensionLabels(page),
        {},
        metricDimensionLabels(page),
      );
      if (!verdict.ok) {
        rows.push(`${id.padEnd(5)} (no scale)`);
        continue;
      }
      const feetPerUnit = (strokes.widthPt / 72) * verdict.feetPerInch;
      const items: SheetTextItem[] = page.items.map((i) => ({
        str: i.str, x: i.x, y: i.y, width: i.width, height: i.height,
      }));
      // THE REAL PIPELINE, then its own candidate list regrouped — rather than
      // a second implementation of the pairer here, which would measure
      // something the app does not do.
      const found = findWallsOnSheet({
        segments: strokes.segments,
        textItems: items,
        pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
        feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });
      const groups = buildingGroups(found.everywhere, feetPerUnit);
      if (groups.length === 0) {
        rows.push(`${id.padEnd(5)} (no candidates)`);
        continue;
      }
      const best = groups[0];
      // `findWallsOnSheet` works in PAGE-WIDTH UNITS: x runs 0..1 across the
      // sheet and y runs 0..(height/width). So a fraction of the sheet is the
      // span itself, not a span divided by a point size.
      const xs = best.flatMap((one) => [one.x1, one.x2]);
      const ys = best.flatMap((one) => [one.y1, one.y2]);
      const wPct = (Math.max(...xs) - Math.min(...xs)) * 100;
      const hPct = ((Math.max(...ys) - Math.min(...ys)) / (strokes.heightPt / strokes.widthPt)) * 100;
      const feet = best.reduce((t: number, one) => t + one.lengthFeet, 0);

      rows.push(
        `${id.padEnd(5)} ${String(best.length).padStart(4)} ${feet.toFixed(0).padStart(7)} ` +
          `${wPct.toFixed(1).padStart(8)} ${hPct.toFixed(1).padStart(8)} ` +
          `${((wPct * hPct) / 100).toFixed(1).padStart(7)}   ${strokes.widthPt.toFixed(0)}x${strokes.heightPt.toFixed(0)}`,
      );
    }
    console.log(rows.join("\n"));
    expect(rows.length).toBeGreaterThan(1);
  }, 900_000);
});
