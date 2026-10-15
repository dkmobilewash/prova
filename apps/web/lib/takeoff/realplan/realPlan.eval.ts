import { Buffer } from "node:buffer";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { segmentsFromOpenPage } from "../sheetStrokes";
import { wallsFromBothEngines } from "../wallRuns";
import { scaleFromDimensions, type DimensionLabel } from "../scaleFromDimensions";
import type { StrokeSegment, WallCandidate } from "../wallVectors";

/**
 * THE REAL-PLAN EVALUATION.
 *
 *     REAL_PLAN_PDF="/path/to/a real set.pdf" REAL_PLAN_PAGES=1,2,3 \
 *       pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan
 *
 * ── WHY THIS EXISTS, AND WHAT IT IS NOT ──
 *
 * `reports/takeoff-bench` grades the finder against Mesa Ridge and a 20-plan
 * holdout, and both are drawn BY OUR OWN GENERATOR. `wallCases.ts` says so in
 * its header — "a pass here is a FLOOR" — and after a day of tuning the bench
 * reads 83% on Mesa and 97% on the holdout, which says precisely nothing about
 * an architect's export. Diego's question, and it is the right one: will this
 * ever work unattended on any set of plans? It will not, and the first thing
 * anybody needs is a number from a REAL sheet rather than from ours.
 *
 * So this is not a test and it asserts almost nothing. It runs the production
 * path — `segmentsFromOpenPage` → `scaleFromDimensions` → `wallsFromBothEngines`
 * — over a sheet nobody here drew, and reports what happened at each stage with
 * a wall clock on it. There is no answer key, so the output is for grading BY
 * EYE against the drawing, which is the property the finder was designed around:
 * a wall in the wrong place is visible in a glance.
 *
 * ── THE CONFIDENTIALITY RULE SHAPES THE WHOLE DESIGN ──
 *
 * Customer plan sets are confidential, and real customer files are never
 * fixtures in this repo. So:
 *
 *   - the PDF path comes from the ENVIRONMENT and nothing is committed;
 *   - with no `REAL_PLAN_PDF` set this file runs one case that says so and
 *     passes, so it can live in the repo without needing a plan to exist;
 *   - it prints METADATA ONLY — counts, feet, milliseconds, thicknesses. No
 *     text from the sheet, no sheet names, no room names, no title block. The
 *     file's basename is printed because the person running it chose the path;
 *   - the overlay goes where `REAL_PLAN_OUT` says, defaulting to a temporary
 *     directory, never into `reports/`.
 *
 * ── WHAT TO LOOK FOR IN THE OUTPUT ──
 *
 * The stages are reported separately because they fail differently, and the
 * question "can this work on real plans" is really four questions:
 *
 *   strokes        did the reader get vector line work at all? A SCANNED sheet
 *                  reports a handful of strokes and an image, and no amount of
 *                  wall-finding can help it.
 *   segments       after flattening. This is `n` for an O(n^2) pairing loop,
 *                  and it is the number that decides whether this is tractable:
 *                  Mesa Ridge's variants run 2k-20k. A real ARCH E sheet
 *                  measured 889,222 strokes on its first page.
 *   scale          `scaleFromDimensions` reading the sheet's own dimension
 *                  strings. Without a scale every length is meaningless, and
 *                  this is the step that has to work before accuracy is even a
 *                  question a person can ask.
 *   walls / feet   what the finder returned, and the thickness histogram, which
 *                  is where a wrong answer shows: a cluster at a thickness
 *                  nobody builds is the 9-1/8in failure this repo has an entry
 *                  about.
 *
 * ── AND THE SCHEDULE, WHICH THE FIRST VERSION OF THIS FILE LEFT OUT ──
 *
 * `TakeoffPlanViewer` hands the finder the company's own wall-type thicknesses,
 * and the product reads a partition schedule off the drawing to fill them
 * (`SCHEDULE_ROWS` in plan-ingest, then `wallTypesFromSchedule`). Running
 * without them is the EMPTY-LIBRARY case, not the production one — see
 * `REAL_PLAN_SCHEDULE_IN`. Reporting a thickness scatter from a run with no
 * schedule as though it were what the product does would understate it exactly
 * as badly as the bench overstates it.
 */

const PDF = process.env.REAL_PLAN_PDF ?? "";
const PAGES = (process.env.REAL_PLAN_PAGES ?? "1")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n >= 1);
/** A ceiling so a 900,000-segment sheet reports that it is intractable rather
 * than hanging the run. Raise it deliberately when measuring that. */
const BUDGET_MS = Number(process.env.REAL_PLAN_BUDGET_MS ?? 120_000);
const OUT = process.env.REAL_PLAN_OUT ?? join(process.env.TMPDIR ?? "/tmp", "real-plan-eval");
/**
 * A SCALE SET BY HAND, which is the workflow rather than a workaround.
 *
 * `1/8" = 1'-0"` is 8 feet of building per inch of paper, so
 * `REAL_PLAN_FEET_PER_INCH=8`. The product has always had a two-click manual
 * calibration and `scaleFromDimensions` is the convenience on top of it — so
 * measuring the finder at a hand-set scale is measuring the real path, and on
 * the five real sheets tried so far it is the ONLY path: not one of them
 * produced an automatic scale.
 */
const FEET_PER_INCH = Number(process.env.REAL_PLAN_FEET_PER_INCH ?? "0");
/**
 * THE PARTITION SCHEDULE, in inches — `REAL_PLAN_SCHEDULE_IN="4.875,6,8.125"`.
 *
 * ── THE FIRST VERSION OF THIS FILE OMITTED IT AND CALLED ITSELF THE PRODUCTION
 * PATH, WHICH IT WAS NOT ──
 *
 * `TakeoffPlanViewer` passes the COMPANY'S OWN wall-type thicknesses into the
 * finder (`knownThicknessesIn`), and those types reach the library three ways:
 * typed by hand, imported, or read off the drawing — `SCHEDULE_ROWS` in
 * `lib/plan-ingest/scheduleRows.ts` extracts the table and
 * `wallTypesFromSchedule` turns accepted rows into types.
 *
 * So the schedule reader EXISTS, and the first run of this harness passed no
 * thicknesses at all and then reported a thickness scatter as though that were
 * what the product does on a real sheet. It is what this harness did on a real
 * sheet with the finder's main discriminator switched off — the opposite error
 * from the bench's, which flatters by grading our own drawings.
 *
 * Empty is still the default, deliberately: a sub whose library is empty is the
 * first-upload case and worth measuring on its own. Supplying a list measures
 * the finder GIVEN CORRECT INPUTS, which is a different and also useful
 * question — and a list somebody guessed is not a measurement of accuracy.
 */
const SCHEDULE_IN = (process.env.REAL_PLAN_SCHEDULE_IN ?? "")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

type Stage = { strokes: number; segments: number; ms: number };

/**
 * A dimension string to feet.
 *
 * ── THIS LIVES HERE BECAUSE PRODUCTION HAS NO SUCH STEP, WHICH IS A FINDING ──
 *
 * `scaleFromDimensions` is written, tested and documented, and it takes
 * `DimensionLabel { text, feet, x, y }`. Nothing in the product builds one from
 * a PDF: the only callers are its own test and a bench probe, both of which
 * hand it labels they constructed. So the automatic scale cannot run on an
 * uploaded sheet today — not because it does not work, but because the step
 * that reads `11' - 0"` off the page and turns it into 11 does not exist
 * anywhere but here.
 *
 * That is the "written, documented, and never called" shape this repo has a
 * name for, and it is the first thing standing between an upload and a takeoff.
 * Deliberately a harness-local parser rather than a shared one: the product's
 * version needs its own tests and its own decisions about what to refuse, and
 * writing it here would be a feature smuggled into an eval.
 *
 * Handles the forms a US architectural sheet prints: `11' - 0"`, `11'-0"`,
 * `11'`, `6"`, `11' 6"`. Returns null for anything else, which is most text on
 * a sheet.
 */
function feetFromLabel(text: string): number | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  // Feet and inches, with or without the dash.
  const both = cleaned.match(/^(\d+)\s*'\s*-?\s*(\d+(?:\s*\d+\/\d+)?)\s*"$/);
  if (both) {
    const inches = both[2].includes("/")
      ? Number(both[2].split(" ")[0]) + eval24(both[2].split(" ").slice(1).join(" "))
      : Number(both[2]);
    return Number(both[1]) + inches / 12;
  }
  const feetOnly = cleaned.match(/^(\d+)\s*'$/);
  if (feetOnly) return Number(feetOnly[1]);
  const inchesOnly = cleaned.match(/^(\d+)\s*"$/);
  if (inchesOnly) return Number(inchesOnly[1]) / 12;
  return null;
}

/** `1/2` -> 0.5. Only ever fed a fraction this file matched. */
function eval24(fraction: string): number {
  const [a, b] = fraction.split("/").map(Number);
  return b > 0 ? a / b : 0;
}

async function readPage(bytes: Buffer, pageNumber: number) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // @ts-expect-error pdfjs ships no types for the worker build; imported for its side effect.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const page = await doc.getPage(pageNumber);
  const unit = page.getViewport({ scale: 1 });
  const pageSize = { widthPt: unit.width, heightPt: unit.height };

  const started = Date.now();
  const { segments } = await segmentsFromOpenPage(page, pdfjs, pageNumber);
  const readMs = Date.now() - started;

  // The sheet's own dimension strings, in the shape `scaleFromDimensions`
  // takes: PAGE POINTS, and `feet` already parsed. Metadata only — the counts
  // and the parsed numbers are reported, the strings never are.
  const content = (await page.getTextContent()) ?? { items: [] };
  const viewport = page.getViewport({ scale: 1 });
  let textItems = 0;
  const labels: DimensionLabel[] = content.items.flatMap((raw: unknown) => {
    const item = raw as { str?: string; transform?: number[] };
    if (typeof item.str !== "string" || !Array.isArray(item.transform)) return [];
    textItems += 1;
    const feet = feetFromLabel(item.str);
    if (feet === null || feet <= 0) return [];
    const m = pdfjs.Util.transform(viewport.transform, item.transform);
    return [{ text: item.str, feet, x: m[4], y: m[5] }];
  });

  return { pageSize, segments, labels, textItems, readMs };
}

/** An SVG overlay, for grading by eye. Deliberately not a PNG: no raster
 * dependency, and a reviewer can open it beside the PDF at any zoom. */
function overlay(walls: readonly WallCandidate[], w: number, h: number): string {
  const lines = walls
    .map(
      (wall) =>
        `<line x1="${wall.x1.toFixed(2)}" y1="${wall.y1.toFixed(2)}" x2="${wall.x2.toFixed(2)}" y2="${wall.y2.toFixed(2)}" stroke="#e11d48" stroke-width="2" />`,
    )
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<rect width="100%" height="100%" fill="#fff"/>\n${lines}\n</svg>\n`;
}

/**
 * `skipIf` rather than an early return, and a non-zero input assertion below,
 * because `lib/ask/eval/harness.test.ts` holds every keyless eval to both and
 * it is right to. That census caught the first draft of this file: an eval that
 * runs with nothing set and passes is scoring a clean zero, which is the
 * vacuous green this whole directory exists to refuse.
 */
describe.skipIf(PDF === "")("the finder on a sheet nobody here drew", () => {
  const bytes = PDF === "" ? Buffer.alloc(0) : readFileSync(PDF);
  if (PDF !== "") mkdirSync(OUT, { recursive: true });

  for (const pageNumber of PAGES) {
    it(`page ${pageNumber}`, async () => {
      const { pageSize, segments, labels, textItems, readMs } = await readPage(bytes, pageNumber);
      // THE INPUT RESOLVED TO SOMETHING. A path to a PDF with no vector line
      // work — a scan — returns no segments, and without this the run would
      // report "0 segments" and pass, which reads as a clean result rather than
      // as a sheet this cannot be used on. Required of every keyless eval by
      // `lib/ask/eval/harness.test.ts`.
      expect(
        segments.length,
        "no vector line work on this page — a scanned or raster sheet cannot be measured by any of this",
      ).toBeGreaterThan(0);
      const stage: Stage = { strokes: segments.length, segments: segments.length, ms: readMs };

      // THE SCALE, from the sheet's own dimensions. Reported as a verdict
      // rather than a number because "no confident scale" is the honest and
      // common answer, and it decides whether anything below means anything.
      const verdict = scaleFromDimensions(labels, segments, { pageWidthPt: pageSize.widthPt });
      // `feetPerInch` is feet of building per INCH of paper; the finder works in
      // feet per NORMALISED unit, and one unit is the page width. A hand-set
      // scale wins, because that is what an estimator does on a sheet whose
      // dimensions cannot be read — and it is the only way to measure the
      // finder on one.
      const perInch = FEET_PER_INCH > 0 ? FEET_PER_INCH : verdict.ok ? verdict.feetPerInch : 0;
      const feetPerUnit = perInch > 0 ? (perInch * pageSize.widthPt) / 72 : null;

      const label = `${basename(PDF)} p${pageNumber}`;
      console.error(
        [
          ``,
          `── ${label} ──`,
          `  page          ${Math.round(pageSize.widthPt)}x${Math.round(pageSize.heightPt)}pt`,
          `  segments      ${stage.segments}   (read in ${stage.ms}ms)`,
          `  text items    ${textItems}, of which ${labels.length} parsed as a dimension`,
          `  scale         ${
            verdict.ok
              ? `${verdict.scaleName} — ${verdict.feetPerInch} ft/in, ${verdict.agreed.length} of ${verdict.considered} dimensions agreed, inherited error ${(verdict.inheritedError * 100).toFixed(2)}%`
              : `NONE — ${verdict.reason} (${verdict.considered} considered)`
          }`,
        ].join("\n"),
      );

      if (feetPerUnit === null) {
        console.error(`  walls         NOT ATTEMPTED — no scale, so no length means anything`);
        console.error(`                set REAL_PLAN_FEET_PER_INCH to measure the finder anyway`);
        expect(verdict.ok, "a sheet with no readable scale is a real outcome").toBe(false);
        return;
      }

      // ── THE TRACTABILITY QUESTION, ASKED BEFORE IT IS ANSWERED THE HARD WAY ──
      // The pairing loop is O(n^2) with an O(n) scan inside it. Rather than
      // hang, report the estimate and refuse past the budget.
      // NO PAIR-COUNT GUARD, and the first version's was wrong rather than
      // cautious: it refused on RAW segment count, and `wallsFromStrokes` joins
      // faces and drops anything under the minimum length BEFORE its O(n^2)
      // loop, so the n that matters is far smaller than what the reader
      // returned. Refusing on the wrong number would have reported a real
      // sheet as intractable without ever trying it. The wall clock below is
      // the honest limit.

      const inUnits: StrokeSegment[] = segments.map((s) => ({
        x1: s.x1 / pageSize.widthPt,
        y1: s.y1 / pageSize.widthPt,
        x2: s.x2 / pageSize.widthPt,
        y2: s.y2 / pageSize.widthPt,
        width: s.width,
      }));

      const t0 = Date.now();
      const walls = wallsFromBothEngines(inUnits, 1, pageSize.heightPt / pageSize.widthPt, {
        feetPerPoint: feetPerUnit,
        knownThicknessesIn: SCHEDULE_IN,
      });
      const findMs = Date.now() - t0;

      const feet = walls.reduce((sum, wall) => sum + wall.lengthFeet, 0);
      // The histogram is where a wrong answer shows: a cluster at a thickness
      // nobody builds is this repo's 9-1/8in failure.
      const byThickness = new Map<string, { n: number; ft: number }>();
      for (const wall of walls) {
        const key = (Math.round(wall.thicknessFeet * 12 * 8) / 8).toFixed(3);
        const at = byThickness.get(key) ?? { n: 0, ft: 0 };
        at.n += 1;
        at.ft += wall.lengthFeet;
        byThickness.set(key, at);
      }
      const top = [...byThickness.entries()].sort((a, b) => b[1].ft - a[1].ft).slice(0, 8);

      console.error(
        [
          `  scale used    ${perInch} ft/in${FEET_PER_INCH > 0 ? " (set by hand)" : " (read off the sheet)"}`,
          `  schedule      ${
            SCHEDULE_IN.length === 0
              ? "NONE — an empty wall-type library, the first-upload case. The finder's main discriminator is off."
              : `${SCHEDULE_IN.length} thicknesses supplied`
          }`,
          `  walls         ${walls.length} in ${findMs}ms`,
          `  linear feet   ${feet.toFixed(0)}`,
          `  thicknesses   ${top.map(([t, v]) => `${Number(t).toFixed(2)}" x${v.n} (${v.ft.toFixed(0)}ft)`).join(", ")}`,
        ].join("\n"),
      );

      const svg = join(OUT, `${basename(PDF, ".pdf")}-p${pageNumber}.svg`);
      writeFileSync(svg, overlay(walls, pageSize.widthPt, pageSize.heightPt));
      console.error(`  overlay       ${svg}`);
      console.error(`                open it beside the sheet; a wall in the wrong place is visible`);

      // The only assertion: it got through the production path and measured
      // something. Accuracy is for the eye, and there is no key.
      expect(findMs, "the finder completed").toBeLessThan(BUDGET_MS);
    }, 600_000);
  }
});
