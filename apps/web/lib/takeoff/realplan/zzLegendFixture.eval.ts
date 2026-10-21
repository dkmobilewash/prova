import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { legendCropRects } from "@/lib/takeoff/legendSight";
import { storedLegendTypes } from "@/lib/takeoff/legendProposal";
import { tagSymbols } from "@/lib/takeoff/tagSymbols";

/**
 * Builds a stored `PlanLegendProposal` for a REAL legend page — Baker's A601 —
 * from the two cached model reads (words, and sight under prompt v6) and the
 * crop rectangles the ingest would place from the page's own text and
 * symbols. No model call. It writes OUTSIDE the repository: the file holds a
 * client's legend verbatim, and `wall-legend-library.spec.ts` reads it only
 * when `LEGEND_FIXTURE` names it, beside the drawing in `REAL_PLAN_DIR`. The
 * committed fixture that spec runs on by default is invented.
 *
 *     REAL_PLAN_DIR=… LEGEND_CACHE=… LEGEND_FIXTURE_OUT="$HOME/Claude Folder/takeoff/fixtures/baker-wall-legend.json" \
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzLegendFixture.eval.ts
 *
 * Skips without all three, refuses an output path inside the repository, and
 * asserts the page and the reads resolved to something before writing, so a
 * mistyped folder cannot produce an empty fixture.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";
const OUT = process.env.LEGEND_FIXTURE_OUT ?? "";
const SET = "2025.07.08_Baker_EOC_BID.pdf";
const PAGE = 25;

describe.skipIf(DIR === "" || CACHE === "" || OUT === "")("the Baker legend fixture", () => {
  it("is built from the cached reads and the page's own crop placement, outside the repository", async () => {
    expect(/\/prova\//.test(OUT) || !OUT.startsWith("/"), `${OUT} is inside the repository — a client's legend does not get committed`).toBe(false);
    const pdfAt = `${DIR}/${SET}`;
    expect(existsSync(pdfAt), `no drawing at ${pdfAt}`).toBe(true);
    const text = JSON.parse(readFileSync(`${CACHE}/2025_07_08_Baker_EOC_BID_pdf-p25-wall-legend.1.json`, "utf8"));
    const sight = JSON.parse(readFileSync(`${CACHE}/2025_07_08_Baker_EOC_BID_pdf-p25-wall-legend-sight.6.json`, "utf8"));
    expect(text.types.length, "the cached text read has no types").toBeGreaterThan(0);
    const doc = await openPlanPdf(Buffer.from(readFileSync(pdfAt)));
    const page = await doc.pageText(PAGE);
    const items = page.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
    expect(items.length, "the legend page has no text").toBeGreaterThan(50);
    const strokes = await doc.pageStrokes(PAGE);
    const symbols = tagSymbols({ segments: strokes.segments, text: items, unitsPerPaperInch: 72 });
    const codes = text.types.map((t: { code: string }) => t.code);
    const crops = legendCropRects({ text: items, codes, widthPt: page.widthPt, heightPt: page.heightPt, symbols });
    const pageCount = doc.pageCount;
    await doc.close();
    expect(crops.length, "no crop could be placed").toBe(codes.length);
    const fixture = {
      pdf: SET,
      pageNumber: PAGE,
      pageCount,
      sheetTitle: "ASSEMBLY LEGEND",
      sheetNumber: "A601",
      textRead: text,
      sightRead: sight,
      merged: storedLegendTypes(text, sight, "A601 ASSEMBLY LEGEND (page 25)"),
      crops,
      reason: sight.reason,
      confidence: sight.confidence,
      model: "fixture — the cached reads of 2026-10-21",
      promptVersion: "wall-legend-sight.6",
    };
    expect(fixture.merged.length).toBe(codes.length);
    writeFileSync(OUT, JSON.stringify(fixture, null, 1));
    console.log(`wrote ${OUT}: ${fixture.merged.length} types, ${crops.length} crops, ${pageCount} pages, ${page.widthPt}x${page.heightPt}pt`);
  });
});
