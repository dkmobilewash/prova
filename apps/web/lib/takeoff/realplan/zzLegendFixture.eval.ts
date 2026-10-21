import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { legendCropRects } from "@/lib/takeoff/legendSight";
import { storedLegendTypes } from "@/lib/takeoff/legendProposal";
import { tagSymbols } from "@/lib/takeoff/tagSymbols";

/**
 * Builds `e2e/fixtures/baker-wall-legend.json`: the stored shape of a
 * `PlanLegendProposal` for Baker's A601 legend page, from the two cached
 * model reads (words, and sight under prompt v6) and the crop rectangles the
 * ingest would place from the page's own text and symbols. No model call.
 *
 *     REAL_PLAN_DIR=… LEGEND_CACHE=… LEGEND_FIXTURE_OUT=e2e/fixtures/baker-wall-legend.json \
 *       npx vitest run lib/takeoff/realplan/zzLegendFixture.eval.ts
 *
 * Skips without all three, and asserts the page and the reads resolved to
 * something before writing, so a mistyped folder cannot produce an empty
 * fixture that the e2e spec would then seed as a legend with no types.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";
const OUT = process.env.LEGEND_FIXTURE_OUT ?? "";
const SET = "2025.07.08_Baker_EOC_BID.pdf";
const PAGE = 25;

describe.skipIf(DIR === "" || CACHE === "" || OUT === "")("the Baker legend fixture", () => {
  it("is built from the cached reads and the page's own crop placement", async () => {
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
