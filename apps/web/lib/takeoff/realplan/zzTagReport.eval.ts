import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WallLegendRead } from "@prova/integrations/src/wallLegend";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { shapeFromLegend, tagSymbols } from "../tagSymbols";
import { TAG_CLEAR_MARGIN, TAG_REACH_FEET } from "../wallTags";

/**
 * ── EVERY SYMBOL THAT HOLDS A LEGEND CODE, AND WHY IT DID OR DID NOT LAND ──
 *
 * `zzChain2` says "35 name a type, 7 matched". This says which 28 did not and
 * why — shape, size, split, where on the sheet, how far the nearest run is and
 * how far the next — so the pairing rules can be judged against the drawing
 * rather than against a total.
 *
 *     REAL_PLAN_DIR=… LEGEND_CACHE=… npx vitest run --config vitest.eval.config.mts \
 *       lib/takeoff/realplan/zzTagReport.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";
const SET = process.env.CHAIN_SET ?? "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf";
const LEGEND_PAGE = Number(process.env.CHAIN_LEGEND ?? "16");
const PLAN_PAGE = Number(process.env.CHAIN_PLAN ?? "8");
const FEET_PER_UNIT = Number(process.env.CHAIN_FPU ?? "288.4866205070642");
const PROMPT_VERSION = "wall-legend.1";

function distanceFeet(px: number, py: number, w: { x1: number; y1: number; x2: number; y2: number }): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / len2));
  return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy)) * FEET_PER_UNIT;
}

describe.skipIf(DIR === "" || CACHE === "")("tag report", () => {
  it("prints every legend-coded symbol with its pairing verdict", { timeout: 1_800_000 }, async () => {
    const cacheAt = join(CACHE, `${SET.replace(/\W+/g, "_")}-p${LEGEND_PAGE}-${PROMPT_VERSION}.json`);
    expect(existsSync(cacheAt)).toBe(true);
    const legend = JSON.parse(readFileSync(cacheAt, "utf8")) as WallLegendRead;
    const codes = new Set(legend.types.map((t) => t.code.toUpperCase()));

    const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, SET))));
    const itemsOf = async (page: number) =>
      (await doc.pageText(page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
    const legendRead = await sheetStrokes(Buffer.from(readFileSync(join(DIR, SET))), LEGEND_PAGE);
    const legendSymbols = tagSymbols({ segments: legendRead.segments, text: await itemsOf(LEGEND_PAGE), unitsPerPaperInch: 72 });
    const shape = shapeFromLegend(legendSymbols, { codes: [...codes] });
    console.log(`legend p${LEGEND_PAGE}: codes ${[...codes].join(" ")}; legend symbols holding a code: ` +
      legendSymbols.filter((s) => codes.has(s.text.toUpperCase())).map((s) => `${s.text}:${s.shape}/r${(s.radius / 72).toFixed(2)}/c${s.corners}`).join(" ") +
      `; shape learned: ${shape}`);

    const planRead = await sheetStrokes(Buffer.from(readFileSync(join(DIR, SET))), PLAN_PAGE);
    const items = await itemsOf(PLAN_PAGE);
    const W = planRead.widthPt;
    const H = planRead.heightPt;
    const found = findWallsOnSheet({ segments: planRead.segments, textItems: items, pageSize: { widthPt: W, heightPt: H }, feetPerUnit: FEET_PER_UNIT, wallTypes: [], sampledSheets: null });
    const symbols = tagSymbols({ segments: planRead.segments, text: items, unitsPerPaperInch: 72 });
    const holding = symbols.filter((s) => s.text.trim().toUpperCase().split(/\s+/).some((w) => codes.has(w)));
    console.log(`\nplan p${PLAN_PAGE}: ${found.walls.length} runs; ${symbols.length} symbols; ${holding.length} hold a legend code (any verdict)\n`);
    console.log("  code     shape    r(in) crn split ldr rej             x     y   near   2nd  verdict");
    const tally = new Map<string, number>();
    for (const s of holding.sort((a, b) => a.text.localeCompare(b.text) || a.x - b.x)) {
      const anchor = s.leader ?? { x: s.x, y: s.y };
      const px = anchor.x / W;
      const py = anchor.y / W;
      let best = Infinity, second = Infinity;
      for (const w of found.walls) {
        const d = distanceFeet(px, py, w);
        if (d < best) { second = best; best = d; } else if (d < second) second = d;
      }
      const verdict =
        s.rejected !== null ? `REJECTED ${s.rejected}` :
        shape !== null && s.shape !== shape ? `odd shape (legend ${shape})` :
        best > TAG_REACH_FEET ? `too far (>${TAG_REACH_FEET} ft)` :
        second < best * TAG_CLEAR_MARGIN ? `no clear margin` : "MATCHED";
      tally.set(verdict, (tally.get(verdict) ?? 0) + 1);
      console.log(
        `  ${s.text.slice(0, 8).padEnd(8)} ${s.shape.padEnd(8)} ${(s.radius / 72).toFixed(3)} ${String(s.corners).padStart(3)} ${s.split ? "Y   " : "    "} ${s.leader ? "Y  " : "   "} ${(s.rejected ?? "-").padEnd(15)} ${(s.x / W).toFixed(3)} ${(s.y / H).toFixed(3)} ${best.toFixed(1).padStart(6)} ${second.toFixed(1).padStart(5)}  ${verdict}`,
      );
    }
    console.log("\n  verdicts: " + [...tally].map(([k, n]) => `${k} ${n}`).join(" | "));
    expect(holding.length).toBeGreaterThan(0);
  });
});
