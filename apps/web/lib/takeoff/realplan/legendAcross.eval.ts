import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetStrokes } from "../sheetStrokes";
import { acrossSheet } from "../symbolAcross";
import { findSymbolsFrom, scaleSymbolTemplate, symbolTemplate } from "../symbolSignature";

/**
 * ── FIND ON ALL SHEETS LEAVES A LEGEND OUT, 20 TIMES OUT OF 20 ──
 *
 * Baker EL1.01 (training): an R1 troffer boxed 20 ways, as 20 drags would box
 * it, a little larger or smaller and off-centre. Each time, E0.03 (ELECTRICAL
 * LEGEND) must count nothing and say it is a legend. EL1.01's own count is printed,
 * not asserted: it moves with the box (12 to 52 in this sample), a separate matter.
 * The same 20 templates, searched on E0.03 without the legend rule, must count its
 * five at least once, or the sample never reached the flake and proves nothing.
 *
 *     REAL_PLAN_DIR="<folder holding 2025.07.08_Baker_EOC_BID.pdf>" \
 *       pnpm exec vitest run --config vitest.eval.config.mts lib/takeoff/realplan/legendAcross.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const FILE = join(DIR, "2025.07.08_Baker_EOC_BID.pdf");

async function sheet(page: number) {
  const strokes = await sheetStrokes(Buffer.from(readFileSync(FILE)), page);
  const doc = await openPlanPdf(Buffer.from(readFileSync(FILE)));
  const text = await doc.pageText(page);
  await doc.close();
  return { segments: strokes.segments, words: text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height })), W: text.widthPt, H: text.heightPt };
}

describe.skipIf(DIR === "" || !existsSync(FILE))("Find on all sheets and a legend sheet", () => {
  it("counts E0.03's legend troffers 0 times in 20 boxes", { timeout: 900_000 }, async () => {
    const own = await sheet(54), legend = await sheet(52);
    expect(own.segments.length, "EL1.01 read to no strokes").toBeGreaterThan(1000);
    expect(legend.segments.length, "E0.03 read to no strokes").toBeGreaterThan(100);
    const segs = own.segments.map((s) => ({ ...s, x1: s.x1 / own.W, y1: s.y1 / own.W, x2: s.x2 / own.W, y2: s.y2 / own.W }));
    const text = own.words.map((w) => ({ x: w.x / own.W, y: (w.y - w.height) / own.W, width: w.width / own.W, height: w.height / own.W, str: w.str }));
    const legendSegs = legend.segments.map((s) => ({ ...s, x1: s.x1 / legend.W, y1: s.y1 / legend.W, x2: s.x2 / legend.W, y2: s.y2 / legend.W }));
    const legendText = legend.words.map((w) => ({ x: w.x / legend.W, y: (w.y - w.height) / legend.W, width: w.width / legend.W, height: w.height / legend.W, str: w.str }));
    let seed = 3;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const R1 = { x: 0.2455, y: 0.3412 };
    let oldWayCounted = 0;
    const seen: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const hw = 0.004 + rand() * 0.003, hh = 0.004 + rand() * 0.003, dx = (rand() - 0.5) * 0.002, dy = (rand() - 0.5) * 0.002;
      const made = symbolTemplate(segs as never, text, { x1: R1.x + dx - hw, y1: R1.y + dy - hh, x2: R1.x + dx + hw, y2: R1.y + dy + hh });
      if (made === null) continue;
      const found = findSymbolsFrom(segs as never, text, made);
      const tpl = { made: { ...made, decidedTag: found.tag }, widthPt: own.W, fpu: null, number: "EL1.01" };
      const row = acrossSheet({ tpl, scope: "discipline", pageNumber: 52, words: legend.words, segments: legend.segments, widthPt: legend.W, heightPt: legend.H });
      const oldWay = findSymbolsFrom(legendSegs as never, legendText, scaleSymbolTemplate(tpl.made, own.W / legend.W)).matches.length;
      if (oldWay > 0) oldWayCounted += 1;
      seen.push(`${found.matches.length}/${found.tag ?? "-"}: E0.03 ${row?.count} (old way ${oldWay})`);
      expect(row, `box ${i}`).not.toBeNull();
      expect([row!.count, row!.legend], `box ${i}`).toEqual([0, true]);
    }
    console.log(`EL1.01 count/tag and E0.03, 20 boxes: ${seen.join(" | ")}`);
    expect(seen).toHaveLength(20);
    expect(oldWayCounted, "the old way never counted the legend in this sample, so it proves nothing").toBeGreaterThan(0);
  });
});
