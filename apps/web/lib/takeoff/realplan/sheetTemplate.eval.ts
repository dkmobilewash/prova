import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { segmentsFromOpenPage } from "../sheetStrokes";
import {
  ON_MOST_SHEETS,
  TEMPLATE_GRID,
  pagesToSample,
  templateFromSheets,
  withoutTemplate,
} from "../sheetTemplate";
import type { StrokeSegment } from "../wallVectors";

/**
 * WHY THE TEMPLATE FILTER MISSED, ON A SHEET IT MISSED ON.
 *
 *     REAL_PLAN_PDF="/path/to/a real set.pdf" REAL_PLAN_PAGES=7 \
 *       pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan/sheetTemplate
 *
 * ── THE DEFECT THIS EXISTS TO DIAGNOSE ──
 *
 * 2026-10-13, a West Herr floor plan clicked on production. The panel said
 * **"12,641 lines on this sheet also appear in the same place on the rest of the
 * set — the border, the title block and the logo — so they were left out"**, and
 * about 32 runs sat on the title block and the logo anyway. So the filter ran,
 * dropped twelve thousand lines, and still let the furniture through — and
 * nothing anywhere said which of its two thresholds was the reason.
 *
 * ── AND WHY A UNIT TEST COULD NOT ANSWER IT, WHICH IS THE POINT ──
 *
 * `sheetTemplate.test.ts` builds its sheets by hand and passes. Both bench sets
 * were then run through this probe before it was committed, and NEITHER can
 * reproduce the defect:
 *
 *   mesa-ridge-bid-set.pdf, p5   10,816 segments → template 26, all on 6 of 6
 *   desert-willow-bid-set.pdf, p3   149 segments → template 18, all on 7 of 7
 *
 * Both are drawn by our own generator, and its page furniture is a bare frame:
 * every template line recurs on EVERY sampled sheet, so the threshold is never
 * near. A real architect's title block is the case that has margins in it, and
 * no drawing in this repo has one.
 *
 * ── SO THIS REPORTS THE HISTOGRAM, NOT A VERDICT ──
 *
 * `templateFromSheets` drops a segment that recurs on `ceil(samples × 0.7)`
 * sampled sheets. That is one number, and a count of what it dropped cannot
 * distinguish the two ways it fails:
 *
 *   the THRESHOLD — the furniture recurred on four of seven sheets and four is
 *                   not five, because a consultant's sheets carry a different
 *                   frame. Shows up as a mass just below the line.
 *   the GRID      — the furniture recurred everywhere and matched nowhere,
 *                   because a page origin or page size differs by more than
 *                   `TEMPLATE_GRID`. Shows up as a mass at ONE sheet that
 *                   collapses when the grid is loosened.
 *
 * The histogram tells those apart in one run, which is the whole reason to print
 * the distribution rather than the total. Neither number is moved until a real
 * sheet says which — a constant invented from no measurement is what this
 * directory keeps deleting.
 *
 * ── CONFIDENTIALITY ──
 *
 * `realPlan.eval.ts` sets the posture and this follows it exactly: the path
 * comes from the environment, nothing is committed, and the output is METADATA
 * ONLY — counts, page widths, grid sizes. No text from the sheet, no sheet
 * names, no title-block content. The basename is printed because the person
 * running it chose the path.
 */

const PDF = process.env.REAL_PLAN_PDF ?? "";
const PAGE = Number(process.env.REAL_PLAN_PAGES ?? "1");
/** Multiples of `TEMPLATE_GRID` to re-measure at, so a near-miss is visible. */
const GRIDS = [1, 2, 4, 8];

describe.skipIf(PDF === "")("why the template filter missed", () => {
  it("reports how often this sheet's lines recur across the set", async () => {
    const bytes = readFileSync(PDF);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-expect-error pdfjs ships no types for the worker build; imported for its side effect.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      verbosity: 0,
    }).promise;

    // PAGE-WIDTH UNITS, each sheet by its OWN width — the production path. A
    // set of mixed page sizes compares one sheet's coordinates against
    // another's scale, and that is one of the two failures being looked for.
    const unitsOf = (over: number) => (one: StrokeSegment): StrokeSegment => ({
      x1: one.x1 / over,
      y1: one.y1 / over,
      x2: one.x2 / over,
      y2: one.y2 / over,
      width: one.width,
      curved: one.curved,
    });

    const pages = pagesToSample(doc.numPages, PAGE);
    const sampled: StrokeSegment[][] = [];
    const widths: number[] = [];
    for (const n of pages) {
      const page = await doc.getPage(n);
      const read = await segmentsFromOpenPage(page, pdfjs, n);
      widths.push(read.widthPt);
      sampled.push(read.segments.map(unitsOf(read.widthPt || widths[0])));
    }
    const mine = sampled[pages.indexOf(PAGE)] ?? sampled[0];
    const withContent = sampled.filter((one) => one.length > 0).length;
    const needed = Math.ceil(withContent * ON_MOST_SHEETS);

    console.log(`\n${basename(PDF)} — ${doc.numPages} pages, sampled ${pages.join(",")}`);
    // MIXED PAGE SIZES ARE ONE OF THE TWO CAUSES, so the widths are printed
    // rather than assumed: every figure below is a fraction of them.
    console.log(`page widths (pt): ${widths.join(", ")}`);
    console.log(`segments per sampled sheet: ${sampled.map((one) => one.length).join(", ")}`);
    console.log(`sheets with line work: ${withContent} — a line must recur on ${needed} to be dropped`);

    for (const multiple of GRIDS) {
      const grid = TEMPLATE_GRID * multiple;
      // ONE SET PER THRESHOLD, built from the real function rather than a copy
      // of its key format. `templateFromSheets` is given a rising
      // `onMostSheets` so that "recurs on exactly n sheets" is the difference
      // between two of its own answers — nothing here reimplements the key, so
      // the histogram cannot drift from what production would drop.
      const keptAbove: number[] = [];
      for (let on = 1; on <= withContent; on += 1) {
        const template = templateFromSheets(sampled, {
          grid,
          minSheets: 1,
          // A hair under, so floating point cannot push `ceil` to n+1 — the
          // exact trap that made this filter one sheet stricter than its own
          // comment claimed.
          onMostSheets: on / withContent - 1e-9,
        });
        keptAbove.push(mine.length - withoutTemplate(mine, template, grid).length);
      }

      console.log(`\ngrid ${grid}${multiple === 1 ? " (production)" : ` (${multiple}x)`}`);
      for (let on = withContent; on >= 1; on -= 1) {
        // Segments recurring on EXACTLY `on` sheets: those at `on` or more,
        // minus those at `on + 1` or more.
        const exactly = keptAbove[on - 1] - (keptAbove[on] ?? 0);
        if (exactly === 0) continue;
        const mark = on >= needed ? "  <- dropped" : "";
        console.log(`  on ${on} sheet(s): ${exactly.toLocaleString()} segments${mark}`);
      }
      const dropped = keptAbove[needed - 1] ?? 0;
      const oneLess = keptAbove[Math.max(needed - 2, 0)] ?? 0;
      console.log(`  dropped: ${dropped.toLocaleString()} of ${mine.length.toLocaleString()}`);
      console.log(`  at ${needed - 1} instead of ${needed}: ${oneLess.toLocaleString()} (+${(oneLess - dropped).toLocaleString()})`);
    }

    // THE INPUT RESOLVED TO SOMETHING. A path that parses to no line work must
    // read as a failure and not as a sheet with no furniture on it — the
    // keyless-eval promise, asserted here by the means this file has.
    expect(mine.length, "the sheet parsed to no line work at all").toBeGreaterThan(0);
  }, 600_000);
});
