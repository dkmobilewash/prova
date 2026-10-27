import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WallLegendRead } from "@prova/integrations/src/wallLegend";
import { componentRunQuantity, runGeometry } from "../../wall-assemblies";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { readPartitionAssembly } from "../partitionAssembly";
import { sheetStrokes } from "../sheetStrokes";
import { shapeFromLegend, tagSymbols } from "../tagSymbols";
import { symbolTagSentence, tagsFromSymbols } from "../symbolTagging";
import { coverageSentence, sheetTypeCoverage } from "../typeCoverage";

/**
 * ── ONE WALL TYPE, END TO END, WITH THE TAG READ FROM ITS SYMBOL ──
 *
 *   the legend sheet   ->  its symbol SHAPE and its codes
 *   the plan sheet     ->  symbols of that shape holding those codes
 *   each tag           ->  the run it labels
 *   the legend's words ->  proposed components
 *   the run's footage  ->  studs, track, board, insulation
 *
 * The earlier version of this chain stopped at the first step: `wallTypeTags`
 * matches a tag by its TEXT and Camp Bow Wow's partition marks are bare `A`
 * and `B`, which no text pattern can admit without flooding the sheet. It read
 * zero on A101. Reading the SYMBOL instead is what closes it.
 *
 *     REAL_PLAN_DIR=… LEGEND_CACHE=… npx vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan/zzChain2.eval.ts
 *
 * The legend read is taken from the cache `zzLegendRead.eval.ts` writes, so
 * this costs nothing to re-run.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";
const SET = process.env.CHAIN_SET ?? "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf";
const LEGEND_PAGE = Number(process.env.CHAIN_LEGEND ?? "16");
const PLAN_PAGE = Number(process.env.CHAIN_PLAN ?? "8");
const FEET_PER_UNIT = Number(process.env.CHAIN_FPU ?? "288.4866205070642");
/** The estimator's, not the drawing's — A130 note 10 sends heights to the sections. */
const ASSUMED_HEIGHT_FT = 10;
const PROMPT_VERSION = "wall-legend.1";

describe.skipIf(DIR === "" || CACHE === "")("one wall type, end to end", () => {
  it("reads the tag from its symbol and prices the runs", { timeout: 1_800_000 }, async () => {
    const cacheAt = join(
      CACHE,
      `${SET.replace(/\W+/g, "_")}-p${LEGEND_PAGE}-${PROMPT_VERSION}.json`,
    );
    expect(existsSync(cacheAt), `no cached legend at ${cacheAt} — run zzLegendRead first`).toBe(
      true,
    );
    const legend = JSON.parse(readFileSync(cacheAt, "utf8")) as WallLegendRead;

    const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, SET))));
    const itemsOf = async (page: number) => {
      const text = await doc.pageText(page);
      return text.items.map((i) => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      }));
    };

    // ── 1. WHAT SHAPE DOES THIS SET DRAW ITS TAGS IN? ──
    const legendRead = await sheetStrokes(Buffer.from(readFileSync(join(DIR, SET))), LEGEND_PAGE);
    expect(legendRead, "the legend sheet could not be read").not.toBeNull();
    if (legendRead === null) return;
    const legendSymbols = tagSymbols({
      segments: legendRead.segments,
      text: await itemsOf(LEGEND_PAGE),
      unitsPerPaperInch: 72,
    });
    const codes = legend.types.map((t) => t.code);
    const shape = shapeFromLegend(legendSymbols, { codes });
    // eslint-disable-next-line no-console
    console.log(
      `\n1. legend p${LEGEND_PAGE}: ${legend.types.length} types — ${codes.join(", ")}\n` +
        `   tag symbols on the legend: ${legendSymbols.length}, shape used: ${shape ?? "none dominates"}`,
    );
    expect(codes.length, "the cached legend defines no codes").toBeGreaterThan(0);

    // ── 2. THE TAGS ON THE PLAN ──
    const planRead = await sheetStrokes(Buffer.from(readFileSync(join(DIR, SET))), PLAN_PAGE);
    expect(planRead, "the plan could not be read").not.toBeNull();
    if (planRead === null) return;
    const planItems = await itemsOf(PLAN_PAGE);
    const found = findWallsOnSheet({
      segments: planRead.segments,
      textItems: planItems,
      pageSize: { widthPt: planRead.widthPt, heightPt: planRead.heightPt },
      feetPerUnit: FEET_PER_UNIT,
      wallTypes: [],
      sampledSheets: null,
    });
    const planSymbols = tagSymbols({
      segments: planRead.segments,
      text: planItems,
      unitsPerPaperInch: 72,
    });
    const tagged = tagsFromSymbols({
      symbols: planSymbols,
      legendCodes: codes,
      shape,
      walls: found.walls,
      feetPerUnit: FEET_PER_UNIT,
      widthPt: planRead.widthPt,
    });
    // eslint-disable-next-line no-console
    console.log(`\n2. plan p${PLAN_PAGE}: ${symbolTagSentence(tagged)}`);
    if (tagged.unknownCodes.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `   codes the legend does not define: ${tagged.unknownCodes
          .slice(0, 10)
          .map((u) => `${u.code}×${u.count}`)
          .join("  ")}`,
      );
    }

    // ── 3. COVERAGE BY EVIDENCE ──
    const coverage = sheetTypeCoverage({ walls: found.walls, tagged: tagged.byRun, note: null });
    // eslint-disable-next-line no-console
    console.log(`\n3. ${coverageSentence(coverage)}`);
    for (const bucket of coverage.byType.slice(0, 6)) {
      // eslint-disable-next-line no-console
      console.log(
        `   ${(bucket.code ?? "no type").padEnd(10)} ${bucket.feet.toFixed(0).padStart(6)} ft` +
          `  ${String(bucket.runs).padStart(4)} runs  ${bucket.source}`,
      );
    }

    // ── 4. ONE TYPE, PRICED ──
    //
    // The first tagged type whose legend words yield a framing component. A
    // set's biggest tagged type can be masonry (ELEVEN03's WS is 8in block,
    // 430 ft) and that is not a failure of anything — but it is not the type
    // that shows the chain either, so the next framed one is taken.
    const ASSEMBLY = /\b(STUDS?|GYP|GWB|BOARD|BATT|INSULATION|TRACK|O\.?\s*C\.?)\b/i;
    const taggedBuckets = coverage.byType.filter((b) => b.source === "tag" && b.code !== null);
    const framed = taggedBuckets.find((b) => {
      const t = legend.types.find((one) => one.code.toUpperCase() === b.code);
      return (
        t !== undefined &&
        readPartitionAssembly({ lines: t.lines, where: "pick" }).components.length > 0
      );
    });
    const priced = framed ?? taggedBuckets[0];
    if (priced === undefined || priced.code === null) {
      // eslint-disable-next-line no-console
      console.log(
        `\n4. NOT SHOWN: no run on this sheet carries a tag naming a legend type. ` +
          `That is the coverage in step 3, not a break in the chain.`,
      );
      expect(found.walls.length).toBeGreaterThan(0);
      return;
    }
    const type = legend.types.find((t) => t.code.toUpperCase() === priced.code);
    expect(type, `the legend has no type ${priced.code}`).not.toBeUndefined();
    if (type === undefined) return;

    const assembly = readPartitionAssembly({
      lines: type.lines,
      where: `${SET.slice(0, 20)} p${LEGEND_PAGE}, type ${type.code}`,
    });
    // ── A LEGEND BY UL NUMBER STOPS HERE, AND SAYS SO ──
    //
    // ELEVEN03's legend is TAG / UL# / RATING and describes no assembly in
    // words, so there is nothing to propose a component from and nothing
    // should be. The chain has still done its work — tag, run, coverage — and
    // the report says where it stopped rather than failing on a legend that
    // was read correctly.
    if (assembly.components.length === 0 && !type.lines.some((l) => ASSEMBLY.test(l))) {
      // eslint-disable-next-line no-console
      console.log(
        `\n4. type ${type.code} — ${priced.runs} runs, ${priced.feet.toFixed(0)} ft. The legend's words are\n` +
          type.lines.map((l) => `     "${l.slice(0, 68)}"`).join("\n") +
          `\n   NO FRAMING ASSEMBLY IN WORDS: the type is masonry, or specified by UL design ` +
          `number only, so no component can be proposed from the drawing. The chain stops at coverage.`,
      );
      expect(found.walls.length).toBeGreaterThan(0);
      return;
    }
    const wallType = {
      id: "proposed",
      code: type.code,
      defaultHeightFt: null,
      sides: 2,
      studSpacingIn: assembly.read.studSpacingIn ?? 16,
      boardLayers: null,
      components: assembly.components.map((c, at) => ({
        id: `c${at}`,
        description: c.description,
        unit: c.unit,
        basis: c.basis,
        factor: c.factor,
        wastePercent: c.wastePercent,
        roundUp: c.roundUp,
        // A proposal writes its layer count into the board factor.
        perLayer: false,
        // The consumer's type carries the PRICE half; a proposal does not have
        // these fields at all.
        productionRate: null,
        craftClassificationId: null,
        costCategory: null,
        catalogEntryId: null,
      })),
    };
    const geometry = runGeometry(
      {
        id: "chain",
        label: type.code,
        wallTypeId: wallType.id,
        lengthFt: priced.feet,
        heightFt: ASSUMED_HEIGHT_FT,
        openings: [],
      },
      wallType,
    );
    expect(geometry, "the run produced no geometry").not.toBeNull();
    if (geometry === null) return;

    // eslint-disable-next-line no-console
    console.log(
      `\n4. type ${type.code} — ${priced.runs} runs, ${priced.feet.toFixed(0)} ft, ` +
        `at an ASSUMED ${ASSUMED_HEIGHT_FT} ft height\n` +
        `   the legend's words:\n` +
        type.lines
          .slice(0, 6)
          .map((l) => `     "${l.slice(0, 68)}"`)
          .join("\n") +
        `\n   quantities:\n` +
        wallType.components
          .map(
            (c) =>
              `     ${c.description.padEnd(40)} ${componentRunQuantity(c, geometry, wallType)
                .toFixed(1)
                .padStart(9)} ${c.unit ?? ""}`,
          )
          .join("\n") +
        (assembly.flags.length === 0
          ? ""
          : `\n   FLAGGED for review: ${assembly.flags.map((f) => f.why).join("; ")}`),
    );
    expect(wallType.components.length, "the type produced no components").toBeGreaterThan(0);
  });
});
