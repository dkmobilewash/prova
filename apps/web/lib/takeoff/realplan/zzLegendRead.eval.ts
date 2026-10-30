import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractWallLegend, WALL_LEGEND_PROMPT_VERSION, type WallLegendRead } from "@prova/integrations/src/wallLegend";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { legendPages, type PageForLegend } from "../legendPages";
import { readPartitionAssembly } from "../partitionAssembly";
import { nameSheet } from "./nameSheet";

/**
 * ── FIND THE LEGEND, READ IT ONCE, CACHE IT, TURN IT INTO COMPONENTS ──
 *
 *     REAL_PLAN_DIR=… LEGEND_SET="<file>" LEGEND_CACHE=/some/dir \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzLegendRead.eval.ts
 *
 * ── IT COSTS MONEY, SO IT CACHES, AND THE CACHE IS THE POINT ──
 *
 * One model call per SET, not per sheet: a legend is written once for a
 * building and every floor plan refers back to it. The cache is keyed on the
 * file, the page and the prompt version, so re-running this eval to look at
 * the components costs nothing and changing the prompt costs one call. Delete
 * the file to pay again.
 *
 * Set `LEGEND_LIVE=0` to refuse the call outright and read only what is
 * cached, which is what a run that merely wants to see the parsing should do.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.LEGEND_SET ?? "";
const CACHE = process.env.LEGEND_CACHE ?? "";
const LIVE = process.env.LEGEND_LIVE !== "0";
// The cache key follows the prompt, so a prompt change costs one call and nothing stale is read back.
const PROMPT_VERSION = WALL_LEGEND_PROMPT_VERSION;

/** Lines of a page, grouped the way a person reads them. */
async function linesOf(
  doc: Awaited<ReturnType<typeof openPlanPdf>>,
  page: number,
): Promise<string[]> {
  const text = await doc.pageText(page);
  const rows = new Map<number, { x: number; str: string }[]>();
  for (const item of text.items) {
    if (item.str.trim() === "") continue;
    const key = Math.round(item.y / 6);
    rows.set(key, [...(rows.get(key) ?? []), { x: item.x, str: item.str }]);
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cells]) =>
      cells
        .sort((a, b) => a.x - b.x)
        .map((c) => c.str.trim())
        .join(" | ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line !== "");
}

describe.skipIf(DIR === "" || SET === "")("reading a set's partition legend", () => {
  it("finds the page, reads it once, and proposes components", { timeout: 3_600_000 }, async () => {
    const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, SET))));
    const pages: PageForLegend[] = [];
    for (let page = 1; page <= doc.pageCount; page += 1) {
      const lines = await linesOf(doc, page);
      // The title is the sheet's own, read off the title block by glyph size
      // the way `realSheets.eval.ts` does. An earlier version took the first
      // LINE anywhere on the page that mentioned a wall type, which made every
      // floor plan with a "see wall types" note a titled legend: Murray Towers
      // offered all eight floor plans as rank-0 candidates.
      const text = await doc.pageText(page);
      const named = nameSheet(
        text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, height: i.height })),
        { widthPt: text.widthPt, heightPt: text.heightPt },
      );
      pages.push({ page, title: `${named.number} ${named.title}`.trim() || null, lines });
    }

    const candidates = legendPages(pages);
    // eslint-disable-next-line no-console
    console.log(
      `\n${SET.slice(0, 30)} — ${doc.pageCount} pages, ${candidates.length} could be the legend\n` +
        candidates
          .slice(0, 8)
          .map((c) => `   p${String(c.page).padStart(3)}  ${c.why}`)
          .join("\n"),
    );
    expect(candidates.length, "no page in the set could be a partition legend").toBeGreaterThan(0);

    // ── ONE CALL PER SET, AND A SECOND ONLY WHEN THE FIRST SAYS "NOT A LEGEND" ──
    //
    // A legend read that returns no types is a real answer about that PAGE —
    // the candidate was structural notes, or a sheet of wall sections — and
    // not about the set. So the next candidate gets the second call, and no
    // more: two empty reads mean the set has no legend this can find.
    let best = candidates[0];
    let read: WallLegendRead | null = null;
    for (const candidate of candidates.slice(0, 2)) {
      best = candidate;
      const lines = pages.find((p) => p.page === best.page)?.lines ?? [];
      const key = `${SET.replace(/\W+/g, "_")}-p${best.page}-${PROMPT_VERSION}.json`;
      const cacheAt = CACHE === "" ? null : join(CACHE, key);
      if (cacheAt !== null && existsSync(cacheAt)) {
        read = JSON.parse(readFileSync(cacheAt, "utf8")) as WallLegendRead;
        // eslint-disable-next-line no-console
        console.log(`\n   cached: ${cacheAt}`);
      } else if (LIVE) {
        let spent = { input: 0, output: 0 };
        read = await extractWallLegend({
          lines,
          pageNumber: best.page,
          sheetTitle: pages.find((p) => p.page === best.page)?.title ?? null,
          onUsage: (usage) => {
            spent = { input: usage.inputTokens, output: usage.outputTokens };
          },
        });
        if (cacheAt !== null) {
          mkdirSync(CACHE, { recursive: true });
          writeFileSync(cacheAt, JSON.stringify(read, null, 1), "utf8");
        }
        // Opus 5 is $5 per Mtok in and $25 out — printed so the cost of a set is
        // a number somebody has seen rather than an estimate.
        const cost = (spent.input / 1e6) * 5 + (spent.output / 1e6) * 25;
        // eslint-disable-next-line no-console
        console.log(
          `\n   LIVE read of p${best.page}: ${spent.input} in, ${spent.output} out, ` +
            `about $${cost.toFixed(3)}`,
        );
      }
      if (read !== null && read.types.length > 0) break;
      if (read !== null) {
        // eslint-disable-next-line no-console
        console.log(`   p${best.page} defines no wall types (${read.reason.slice(0, 120)}) — trying the next candidate`);
      }
    }

    if (read === null) {
      // eslint-disable-next-line no-console
      console.log("\n   nothing cached and LEGEND_LIVE=0, so nothing was read");
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n   ${read.types.length} wall types, confidence ${read.confidence}\n   ${read.reason}\n`,
    );
    // eslint-disable-next-line no-console
    console.log(`   U.N.O. defaults: ${(read.uno ?? []).length === 0 ? "none" : (read.uno ?? []).map((u) => `${u.code} — "${u.note.slice(0, 90)}"`).join("; ")}`);
    for (const type of read.types) {
      const assembly = readPartitionAssembly({
        lines: type.lines,
        where: `${SET.slice(0, 20)} p${best.page}, type ${type.code}`,
      });
      // eslint-disable-next-line no-console
      console.log(
        `   ── ${type.code}${type.name === null ? "" : ` (${type.name})`} ──\n` +
          type.lines.map((l) => `      "${l.slice(0, 76)}"`).join("\n") +
          "\n" +
          assembly.components
            .map((c) => `      -> ${c.description.padEnd(40)} ${c.basis.padEnd(13)} x${c.factor}`)
            .join("\n") +
          (assembly.flags.length === 0
            ? ""
            : `\n      FLAGGED: ${assembly.flags.map((f) => f.why).join("; ")}`),
      );
    }

    // ── CONTROLS ──
    //
    // A read that returned no type at all, or types with no components, would
    // print a tidy nothing and look like a legend with nothing in it.
    expect(read.types.length, "the legend read returned no wall types").toBeGreaterThan(0);

    // ── A LEGEND BY UL NUMBER IS A FINDING, NOT A FAILURE ──
    //
    // ELEVEN03 p96 is a WALL LEGEND table of TAG / UL# / FIRE RATING —
    // "MA | U493 | 1 HR" — and names no studs, no board and no insulation.
    // Nothing here can propose a component from that, and nothing should: the
    // assembly lives in the UL directory, not on the drawing. So the two
    // outcomes are told apart by what the legend's own words CONTAIN, and only
    // the first is a failure:
    //
    //   types with assembly words that yield no components -> the parser is
    //     broken, and the run fails;
    //   types with no assembly words at all -> the set specifies by UL design
    //     number, which is reported and passes.
    const ASSEMBLY = /\b(STUDS?|GYP|GWB|BOARD|BATT|INSULATION|TRACK|O\.?\s*C\.?)\b/i;
    const describing = read.types.filter((t) => t.lines.some((l) => ASSEMBLY.test(l)));
    const anyComponents = read.types.some(
      (t) => readPartitionAssembly({ lines: t.lines, where: "control" }).components.length > 0,
    );
    if (describing.length === 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\n   NO ASSEMBLY TEXT: this legend names ${read.types.length} types and describes ` +
          `none of them in words — it is a table of UL design numbers and ratings. ` +
          `The assembly is in the UL directory, not on this drawing, so no component ` +
          `can be proposed and none should be.`,
      );
      return;
    }
    expect(
      anyComponents,
      `${describing.length} types describe an assembly in words and none produced a component`,
    ).toBe(true);
  });
});
