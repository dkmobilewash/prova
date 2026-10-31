import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetNumberFrom } from "../../plan-ingest/sheetNumber";
import { inPageWidthUnits } from "../findWallsOnSheet";
import { printedScalesOnPage } from "../printedScales";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { findSymbolsFrom, scaleSymbolTemplate, symbolTemplate, type Box } from "../symbolSignature";
import { sheetInScope, type SheetScope } from "../symbolScope";

/**
 * ── ONE BOXED SYMBOL, EVERY SHEET OF THE SET — what the viewer's loop does, timed ──
 *
 *     REAL_PLAN_DIR=… SS_SET=… SS_PAGE=… SS_BOX=x1,y1,x2,y2 [SS_SCOPE=discipline|all] \
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/symbolSet.eval.ts
 *
 * The template is read on SS_PAGE in page-width units; every other sheet in
 * scope is read the same way and the template is laid over it corrected for
 * the two pages' widths (paper size). Where both sheets print a scale and
 * the scales differ, the template is also tried at the model-space size and
 * the sheet keeps whichever count is larger, saying which. No model; no
 * database; prints seconds per sheet and the total. Training sets only.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.SS_SET ?? "";
const PAGE = Number(process.env.SS_PAGE ?? "0");
const BOX = (process.env.SS_BOX ?? "").split(",").map(Number);
const SCOPE = (process.env.SS_SCOPE === "all" ? "all" : "discipline") as SheetScope;

describe.skipIf(DIR === "" || SET === "" || PAGE === 0 || BOX.length !== 4)("one symbol across the set", () => {
  it("counts it on every sheet in scope", { timeout: 3_600_000 }, async () => {
    const path = join(DIR, SET);
    expect(existsSync(path), `${SET} is not under ${DIR}`).toBe(true);
    const doc = await openPlanPdf(Buffer.from(readFileSync(path)));
    expect(doc.pageCount).toBeGreaterThan(0);
    const readPage = async (n: number) => {
      const text = await doc.pageText(n);
      const W = text.widthPt;
      const strokes = await doc.pageStrokes(n);
      return {
        W, items: text.items,
        segs: strokes.segments.map(inPageWidthUnits(W)),
        words: text.items.map((i) => ({ x: i.x / W, y: (i.y - i.height) / W, width: i.width / W, height: i.height / W, str: i.str })),
        number: sheetNumberFrom(text).sheetNumber,
        fpu: scaleFromPrinted(printedScalesOnPage(text.items), text.widthPt, text.heightPt)?.declaredDistanceFeet ?? null,
      };
    };
    const src = await readPage(PAGE);
    // A template page with no strokes is a bad page, not a count of nothing.
    expect(src.segs.length).toBeGreaterThan(0);
    const template: Box = { x1: BOX[0]!, y1: BOX[1]!, x2: BOX[2]!, y2: BOX[3]! };
    const made = symbolTemplate(src.segs, src.words, template);
    expect(made, "nothing drawn inside the box").not.toBeNull();
    const rows: { page: number; number: string | null; count: number; ms: number; scaling: string }[] = [];
    let skipped = 0;
    const t0 = Date.now();
    for (let n = 1; n <= doc.pageCount; n++) {
      const tText = await doc.pageText(n);
      const number = sheetNumberFrom(tText).sheetNumber;
      if (!sheetInScope(SCOPE, src.number, number)) { skipped++; continue; }
      const t1 = Date.now();
      const sheet = n === PAGE ? src : await readPage(n);
      const paper = scaleSymbolTemplate(made!, src.W / sheet.W);
      let best = { count: findSymbolsFrom(sheet.segs, sheet.words, paper).matches.length, scaling: "paper" };
      if (src.fpu !== null && sheet.fpu !== null && Math.abs(src.fpu / sheet.fpu - 1) > 0.05) {
        const model = scaleSymbolTemplate(made!, (src.W / sheet.W) * (src.fpu / sheet.fpu));
        const n2 = findSymbolsFrom(sheet.segs, sheet.words, model).matches.length;
        if (n2 > best.count) best = { count: n2, scaling: `model x${(src.fpu / sheet.fpu).toFixed(2)}` };
      }
      rows.push({ page: n, number, count: best.count, ms: Date.now() - t1, scaling: best.scaling });
    }
    const total = rows.reduce((s, r) => s + r.count, 0);
    const ms = Date.now() - t0;
    console.log(`\nSS ${SET} p${PAGE} scope ${SCOPE}: ${doc.pageCount} pages, ${rows.length} walked, ${skipped} out of scope; total ${total} in ${(ms / 1000).toFixed(1)} s (${(ms / 1000 / Math.max(1, rows.length)).toFixed(2)} s per sheet walked, max ${(Math.max(0, ...rows.map((r) => r.ms)) / 1000).toFixed(1)} s)`);
    for (const r of rows) console.log(`   p${r.page} ${(r.number ?? "—").padEnd(8)} ${String(r.count).padStart(4)}  ${(r.ms / 1000).toFixed(2)} s  ${r.scaling}`);
    await doc.close();
  });
});
