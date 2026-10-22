import { Buffer } from "node:buffer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WallLegendRead } from "@prova/integrations/src/wallLegend";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { shapeFromLegend, tagSymbols, type TagSymbol } from "../tagSymbols";
import { legendVocabulary, tagsFromSymbols } from "../symbolTagging";
import { TAG_CLEAR_MARGIN, TAG_REACH_FEET } from "../wallTags";
import { untypedSentence, untypedWhy } from "../untypedWhy";

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
    // The same vocabulary and the same shape rule as the chain, so a verdict
    // here is the chain's verdict and not a second opinion about it.
    const vocabulary = legendVocabulary([...codes]);
    const knows = (s: TagSymbol) => [s.text, ...s.parts].some((p) => vocabulary.has(p.trim().toUpperCase()));
    const tagged = tagsFromSymbols({ symbols, legendCodes: [...codes], shape, walls: found.walls, feetPerUnit: FEET_PER_UNIT, widthPt: W });
    const holding = symbols.filter(knows);
    console.log(`\nplan p${PLAN_PAGE}: ${found.walls.length} runs; ${symbols.length} symbols; ${holding.length} hold a legend code (any verdict); ` +
      `tags required to be ${tagged.shape ?? "any shape"} (${tagged.shapeFrom === "plan" ? "the plan's own, the legend's shape being absent" : tagged.shapeFrom === "legend" ? "the legend's" : "no shape dominated"})\n`);
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
        s.rejected !== null && !(s.rejected === "sheet-reference" && knows(s)) ? `REJECTED ${s.rejected}` :
        tagged.shape !== null && s.shape !== tagged.shape ? `odd shape (${tagged.shapeFrom} ${tagged.shape})` :
        best > TAG_REACH_FEET ? `too far (>${TAG_REACH_FEET} ft)` :
        second < best * TAG_CLEAR_MARGIN ? `no clear margin` : "MATCHED";
      tally.set(verdict, (tally.get(verdict) ?? 0) + 1);
      console.log(
        `  ${s.text.slice(0, 8).padEnd(8)} ${s.shape.padEnd(8)} ${(s.radius / 72).toFixed(3)} ${String(s.corners).padStart(3)} ${s.split ? "Y   " : "    "} ${s.leader ? "Y  " : "   "} ${(s.rejected ?? "-").padEnd(15)} ${(s.x / W).toFixed(3)} ${(s.y / H).toFixed(3)} ${best.toFixed(1).padStart(6)} ${second.toFixed(1).padStart(5)}  ${verdict}`,
      );
    }
    console.log("\n  verdicts: " + [...tally].map(([k, n]) => `${k} ${n}`).join(" | "));
    // ── THE NUMBER THE PLAN ASKS FOR: WHAT SHARE OF THE FOUND WALLS GOT A TYPE ──
    const typed = tagged.byRun.size;
    console.log(
      `  walls typed: ${typed} of ${found.walls.length} runs (${found.walls.length === 0 ? 0 : Math.round((100 * typed) / found.walls.length)}%)`,
    );
    // ── AND WHY THE REST ARE NOT ──
    const why = untypedWhy({ walls: found.walls, symbols, vocabulary: new Set(vocabulary.keys()), byRun: tagged.byRun, feetPerUnit: FEET_PER_UNIT, widthPt: W, shape: tagged.shape });
    const untypedFeet = found.walls.filter((w) => !tagged.byRun.has(w)).reduce((s, w) => s + w.lengthFeet, 0);
    console.log(`  untyped ${untypedFeet.toFixed(0)} ft because: ${untypedSentence(why)}`);
    if (why.orphanTags.length > 0) console.log(`  orphan tags (no run within ${TAG_REACH_FEET} ft): ${why.orphanTags.map((t) => `${t.code} ${t.nearestFeet.toFixed(1)} ft`).join(", ")}`);
    // ── CROPS FOR A PERSON TO LOOK AT ──
    //
    // `CROP_JSON=path` writes each MATCHED symbol with the run it was paired to,
    // in points, so a renderer can cut a crop around the pair. The pairing is
    // the eval's own nearest-run reading, which is `tagByRun`'s choice wherever
    // the verdict is MATCHED.
    if (process.env.CROP_JSON) {
      const crops = holding.flatMap((s) => {
        const anchor = s.leader ?? { x: s.x, y: s.y };
        let best: { d: number; w: (typeof found.walls)[number] } | null = null;
        for (const w of found.walls) {
          const d = distanceFeet(anchor.x / W, anchor.y / W, w);
          if (best === null || d < best.d) best = { d, w };
        }
        const code = [s.text, ...s.parts].map((p) => p.trim().toUpperCase()).find((p) => vocabulary.has(p)) ?? s.text;
        const matched = tagged.byRun.get(best!.w) === vocabulary.get(code);
        if (!matched || best === null || best.d > TAG_REACH_FEET) return [];
        return [{
          code: s.text, shape: s.shape, sx: s.x, sy: s.y, lx: s.leader?.x ?? null, ly: s.leader?.y ?? null,
          wall: { x1: best.w.x1 * W, y1: best.w.y1 * W, x2: best.w.x2 * W, y2: best.w.y2 * W }, distFt: best.d,
        }];
      });
      writeFileSync(process.env.CROP_JSON, JSON.stringify({ set: SET, page: PLAN_PAGE, widthPt: W, heightPt: H, feetPerUnit: FEET_PER_UNIT, crops }, null, 1));
      console.log(`  wrote ${crops.length} crops to ${process.env.CROP_JSON}`);
    }
    expect(holding.length).toBeGreaterThan(0);
  });
});
