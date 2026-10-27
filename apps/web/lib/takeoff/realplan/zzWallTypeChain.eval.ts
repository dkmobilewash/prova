import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { componentRunQuantity, runGeometry } from "../../wall-assemblies";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { readPartitionAssembly } from "../partitionAssembly";
import { sheetStrokes } from "../sheetStrokes";
import { sheetTypeCoverage, coverageSentence } from "../typeCoverage";
import { tagByRun, wallTypeTags } from "../wallTags";

/**
 * ── ONE WALL TYPE, END TO END, ON A REAL BUILDING ──
 *
 *   the tag beside a wall on A101   ->   the partition legend on A130
 *   ->   proposed components   ->   studs, track, board for that wall's runs
 *
 * Camp Bow Wow, because it is the only one of the five real sets that carries
 * a partition legend at all.
 *
 * ── THE ASSEMBLY TEXT COMES FROM THE LEGEND, NOT FROM A SCHEDULE ROW ──
 *
 * The approved design reads the assembly off `SCHEDULE_ROWS`' output. That
 * stage never runs on this sheet and would not on any sheet in these five
 * sets, which was measured rather than assumed on 2026-10-20:
 *
 *   - `SCHEDULE_ROWS` skips a page whose title-block type is not `SCHEDULE`,
 *     and `planSheets`' own prompt reserves that for a page whose content is a
 *     TABLE, saying "OTHER for anything else, including a legend";
 *   - A130 is titled PARTITION TYPES and is drawn as five DETAILS side by
 *     side, so it is a legend by that definition and types as OTHER;
 *   - no other page in any of the five sets carries a partition schedule.
 *     ELEVEN03's richest assembly page is UL firestop details — somebody
 *     else's assemblies — and Camp Bow Wow p22 and p28 are wall sections.
 *
 * So this eval takes the legend's lines directly, to prove the half of the
 * chain that the missing input does not reach: a code, its words, its
 * components, and the quantities they produce for the runs that carry that
 * code. What is NOT proved here is the association of a legend detail's
 * callouts with the type mark beside it, which is the open piece.
 *
 *     REAL_PLAN_DIR=… npx vitest run --config vitest.eval.config.mts \
 *       lib/takeoff/realplan/zzWallTypeChain.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf";
const PLAN_PAGE = 8;
/** A101's scale, as `set-review-scales` accepted it. */
const FEET_PER_UNIT = 288.4866205070642;

/**
 * Type 1's callouts, read off A130 p16 with `zzPartitionText.eval.ts`.
 *
 * Quoted rather than re-derived because the five details' text interleaves
 * line by line, so picking one type's callouts out of the page is the open
 * piece named above. These are that page's words.
 */
const LEGEND_TYPE_1 = ['3 5/8" MTL. STUD AT 16" O.C.', '5/8" GYP. BD. EACH SIDE, PAINT'];
const LEGEND_WHERE = "Camp Bow Wow A130 p16, PARTITION TYPES";

describe.skipIf(DIR === "")("one wall type, end to end", () => {
  it("goes tag -> legend -> components -> quantities", { timeout: 1_800_000 }, async () => {
    const bytes = Buffer.from(readFileSync(join(DIR, SET)));
    const read = await sheetStrokes(bytes, PLAN_PAGE);
    expect(read, "A101 could not be read").not.toBeNull();
    if (read === null) return;
    const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, SET))));
    const text = await doc.pageText(PLAN_PAGE);
    const items = text.items.map((i) => ({
      str: i.str,
      x: i.x,
      y: i.y,
      width: i.width,
      height: i.height,
    }));

    // ── 1. THE WALLS, AND THE TAGS BESIDE THEM ──
    const found = findWallsOnSheet({
      segments: read.segments,
      textItems: items,
      pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
      feetPerUnit: FEET_PER_UNIT,
      wallTypes: [],
      sampledSheets: null,
    });
    const tags = wallTypeTags(items, read.widthPt);
    const tagged = tagByRun(found.walls, tags, FEET_PER_UNIT);

    // eslint-disable-next-line no-console
    console.log(
      `\n1. A101 p${PLAN_PAGE}: ${found.walls.length} runs, ${tags.length} wall-type tags read, ` +
        `${tagged.size} runs carry one` +
        (tags.length === 0
          ? ""
          : `\n   tags: ${[...new Set(tags.map((t) => t.name))].slice(0, 12).join(", ")}`),
    );

    // ── 2. COVERAGE, BY EVIDENCE ──
    const coverage = sheetTypeCoverage({ walls: found.walls, tagged, note: null });
    // eslint-disable-next-line no-console
    console.log(`\n2. ${coverageSentence(coverage)}`);
    for (const bucket of coverage.byType.slice(0, 8)) {
      // eslint-disable-next-line no-console
      console.log(
        `   ${(bucket.code ?? "no type").padEnd(10)} ${bucket.feet.toFixed(0).padStart(6)} ft` +
          `  ${String(bucket.runs).padStart(4)} runs  ${bucket.source}` +
          `${bucket.evidence === null ? "" : `  (${bucket.evidence.slice(0, 44)})`}`,
      );
    }

    // ── 3. THE LEGEND'S WORDS BECOME COMPONENTS ──
    const assembly = readPartitionAssembly({ lines: LEGEND_TYPE_1, where: LEGEND_WHERE });
    // eslint-disable-next-line no-console
    console.log(
      `\n3. ${LEGEND_WHERE}\n   ${LEGEND_TYPE_1.join("  /  ")}\n` +
        assembly.components
          .map(
            (c) =>
              `   ${c.description.padEnd(42)} ${c.basis.padEnd(13)} x${c.factor}` +
              `   <- "${c.from.phrase}"`,
          )
          .join("\n") +
        (assembly.flags.length === 0
          ? "\n   no ambiguity"
          : `\n   FLAGGED: ${assembly.flags.map((f) => f.why).join("; ")}`),
    );
    expect(assembly.components.length, "the legend produced no components").toBeGreaterThan(0);

    // ── 4. QUANTITIES FOR THE RUNS THAT CARRY THAT TYPE ──
    //
    // The height is the estimator's, not the drawing's: A130 note 10 says "FOR
    // HEIGHTS OF WALLS SEE BUILDING SECTIONS", so a floor plan cannot supply
    // it and nothing here invents one. 10 ft is stated as an assumption so the
    // arithmetic can be shown at all.
    const HEIGHT_FT = 10;
    const typeCode = coverage.byType.find((b) => b.source === "tag")?.code ?? null;
    const runsForType =
      typeCode === null ? [] : found.walls.filter((w) => tagged.get(w) === typeCode);
    const totalFeet = runsForType.reduce((n, w) => n + w.lengthFeet, 0);

    if (runsForType.length > 0) {
      const wallType = {
        id: "proposed",
        code: typeCode ?? "proposed",
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
          // The consumer's type carries the PRICE half; the proposal does not
          // have these fields at all. Null here is the boundary working, not a
          // missing value — see `partitionAssembly.ts`.
          productionRate: null,
          craftClassificationId: null,
          costCategory: null,
          catalogEntryId: null,
        })),
      };
      const geometry = runGeometry(
        {
          id: "chain",
          label: typeCode ?? "",
          wallTypeId: wallType.id,
          lengthFt: totalFeet,
          heightFt: HEIGHT_FT,
          openings: [],
        },
        wallType,
      );
      expect(geometry, "the run produced no geometry").not.toBeNull();
      const lines =
        geometry === null
          ? []
          : wallType.components.map((c) => ({
              description: c.description,
              unit: c.unit,
              quantity: componentRunQuantity(c, geometry, wallType),
            }));
      // eslint-disable-next-line no-console
      console.log(
        `\n4. type ${typeCode}: ${runsForType.length} runs, ${totalFeet.toFixed(0)} ft ` +
          `at an ASSUMED ${HEIGHT_FT} ft height\n` +
          lines
            .map(
              (l) =>
                `   ${l.description.padEnd(42)} ${l.quantity.toFixed(1).padStart(10)} ${l.unit ?? ""}`,
            )
            .join("\n") +
          `\n   (geometry: ${geometry?.linearFt.toFixed(0)} lf, ` +
          `${geometry?.faceSqFt.toFixed(0)} sf one face, ` +
          `${geometry?.boardedSqFt.toFixed(0)} sf boarded, ${geometry?.studs} studs)`,
      );
      expect(lines.length, "no quantity line came out of the chain").toBeGreaterThan(0);
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `\n4. NOT SHOWN: no run on this sheet carries a wall-type tag, so there is ` +
          `nothing to price with the components above. That is the coverage ` +
          `problem in step 2, not a failure of the chain.`,
      );
    }

    expect(found.walls.length, "no wall was found on A101 at all").toBeGreaterThan(0);
  });
});
