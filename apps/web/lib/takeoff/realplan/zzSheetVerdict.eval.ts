import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetNumberFrom } from "../../plan-ingest/sheetNumber";
import { sheetViews } from "../sheetViews";
import { takeoffSheetVerdict } from "../takeoffSheet";

/**
 * ── WHICH SHEETS OF A REAL SET WOULD BE OFFERED FOR WALL DETECTION ──
 *
 *     REAL_PLAN_DIR="/path/to/sets" REAL_PLAN_SET="Camp Bow Wow" \
 *       pnpm --filter @prova/web exec vitest run \
 *         --config vitest.eval.config.mts lib/takeoff/realplan/zzSheetVerdict.eval.ts
 *
 * A130 is PARTITION TYPES and A140 is PLAN DETAILS, and both offered Find the
 * walls exactly as a floor plan does. Pressing it on a partition legend returns
 * hundreds of feet of "wall", because a wall type drawn in section IS two
 * parallel lines a wall-thickness apart, repeated down the sheet — the most
 * convincing phantom this product can make.
 *
 * This runs the product's own `takeoffSheetVerdict` over every sheet of a real
 * set, reading the title block and the view captions exactly as the viewer
 * does, and prints what each sheet would be offered. It asserts only that the
 * reading HAPPENED — the judgement of whether each verdict is right is a
 * person's, which is why the whole list is printed rather than a count.
 *
 * Nothing from the drawings is written anywhere: sheet numbers, titles and
 * verdicts only.
 */

const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.REAL_PLAN_SET ?? "Camp Bow Wow";

describe.skipIf(DIR === "")("which sheets would be offered for detection", () => {
  it(
    "reads every sheet's title block and says what it would do",
    async () => {
      const matches = readdirSync(DIR).filter(
        (name) => name.toLowerCase().endsWith(".pdf") && name.includes(SET),
      );
      expect(matches.length, `no pdf in REAL_PLAN_DIR matching "${SET}"`).toBeGreaterThan(0);

      const pdf = await openPlanPdf(readFileSync(join(DIR, matches[0])));
      console.log(`\n=== ${matches[0]} — ${pdf.pageCount} sheets ===`);
      let offered = 0;
      let refused = 0;
      for (let page = 1; page <= pdf.pageCount; page += 1) {
        const text = await pdf.pageText(page);
        const items = text.items.map((i) => ({
          str: i.str,
          x: i.x,
          y: i.y,
          width: i.width,
          height: i.height,
        }));
        const reading = sheetNumberFrom({
          pageNumber: page,
          widthPt: text.widthPt,
          heightPt: text.heightPt,
          rotation: 0,
          items,
        });
        const views = sheetViews(items, text.widthPt).map((view) => view.name);
        const verdict = takeoffSheetVerdict({
          sheetNumber: reading.sheetNumber,
          title: reading.regionText,
          viewNames: views,
        });
        if (verdict.worthMeasuring) offered += 1;
        else refused += 1;
        const mark = verdict.worthMeasuring ? "OFFER " : "refuse";
        console.log(
          `  ${mark} p${String(page).padStart(2)} [${(reading.sheetNumber ?? "?").padEnd(6)}] ` +
            `${verdict.why ?? ""}${views.length > 0 ? `   views: ${views.slice(0, 3).join(" | ")}` : ""}`,
        );
      }
      console.log(`\n  offered ${offered}, refused ${refused}`);
      await pdf.close();
    },
    600_000,
  );
});
