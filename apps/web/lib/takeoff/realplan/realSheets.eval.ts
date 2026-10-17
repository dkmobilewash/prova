import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { dimensionLabels, metricDimensionLabels } from "../../plan-ingest/dimensionLabels";
import { readSheetScale } from "../scaleFromDimensions";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { printedScalesOnPage } from "../printedScales";
import { feetPerUnitFrom, sheetScale } from "../sheetScale";
import { findWallsOnSheet, type SheetTextItem } from "../findWallsOnSheet";
import { sheetSuitability } from "../sheetSuitability";
import { nameSheet } from "./nameSheet";
import { answerKeyFromJson, scoreAgainstKey, type AnswerKey, type KeyScore } from "../answerKey";
import { takeoffRank, type SheetRank } from "../sheetSuitability";
import {
  primaryView,
  sheetViews,
  viewRegions,
  viewsInRegions,
  insideView,
  viewsWithOwnScale,
  wallsPerView,
} from "../sheetViews";
import { clusterByThickness, type StrokeSegment, type WallCandidate } from "../wallVectors";

/**
 * ── THE WHOLE SET, NOT ONE SHEET: WHICH SHEETS ARE FLOOR PLANS, AND WHAT THE
 *    FINDER DOES ON THEM ──
 *
 *     REAL_PLAN_DIR="/path/to/a folder of sets" \
 *       pnpm --filter @prova/web exec vitest run \
 *         --config vitest.eval.config.mts lib/takeoff/realplan/realSheets.eval.ts
 *
 * `realPlan.eval.ts` beside this file takes ONE pdf and a list of page numbers
 * somebody worked out by hand, and calls `wallsFromBothEngines` — the pairer
 * alone, which is the path the product had before `findWallsOnSheet` existed.
 * This one takes a FOLDER, finds the floor plans itself, and runs the product's
 * pipeline including the multi-view split, so what it reports is what an
 * estimator would be shown.
 *
 * ── NOTHING FROM THESE DRAWINGS IS WRITTEN INTO THE REPOSITORY ──
 *
 * A real set is a client's confidential document. This file reads from
 * `REAL_PLAN_DIR` and writes to `REAL_PLAN_OUT`, both outside the tree, and
 * neither default points inside it. What it prints is MEASUREMENT — sheet
 * numbers, scales, footage, thickness clusters, layer names — and not drawing
 * content. The PDFs are never copied and no fixture is derived from them.
 *
 * With no `REAL_PLAN_DIR` the file skips, loudly, rather than passing on
 * nothing — the same bar every keyless eval in this repo is held to.
 */

const DIR = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.REAL_PLAN_OUT ?? join(process.env.TMPDIR ?? "/tmp", "real-plan-report");

/**
 * A sheet whose own title block says it is a floor plan, and which carries
 * enough geometry to measure. Both halves matter: `sheetSuitability` rejects a
 * ceiling plan, an elevation and a partition legend by TITLE, and the stroke
 * count rejects an index page that happens to be called a plan.
 */
const MIN_SEGMENTS = 400;

/** How many floor plans to take per set, biggest first by stroke count. */
const PER_SET = Number(process.env.REAL_PLAN_PER_SET ?? "4");

/**
 * An explicit page list, which OVERRIDES the automatic pick:
 *
 *     REAL_PLAN_SHEETS="Camp Bow Wow:8,9;ELEVEN03 PERMIT:119,120"
 *
 * The key is any substring of the file name. It exists because the automatic
 * pick is demonstrably not good enough on a real set, in two ways worth
 * recording:
 *
 *   - "biggest by stroke count" chose the wrong five on the Eleven03 set. Its
 *     LIFE SAFETY & OCCUPANCY plans carry more linework than its actual
 *     FLOOR PLAN LEVEL sheets, so the real floor plans lost the cut.
 *   - requiring the word PLAN in the title block misses a sheet whose title
 *     wraps, and the title-block region does not always hold the title at all.
 *
 * So a reader who has eyes on the set can name the sheets, and the automatic
 * pick stays for the case where nobody has.
 */
/**
 * ── THE FIXED LIST, SO THE DENOMINATOR CANNOT DRIFT ──
 *
 * This report used to choose its own sheets — the biggest PLAN-titled ones by
 * stroke count, four per set — and the choice moved whenever the title reader
 * improved. One run measured six sheets, a later one two, and neither number
 * was wrong about the pipeline: they were about different sheets.
 *
 * So the sheets are named, by what the drawing calls itself rather than by
 * page number, which survives a set being re-exported. "Measured X of N" means
 * something only against a fixed N.
 *
 * Keyed on a substring of the file name. A sheet named here is taken as given:
 * somebody has looked at it and decided it is a floor plan.
 */
const FIXED_SHEETS: ReadonlyArray<{ key: string; numbers: readonly string[] }> = [
  { key: "Camp Bow Wow", numbers: ["A101", "A102", "A120"] },
  { key: "ELEVEN03 PERMIT SET", numbers: ["A4.B-Y2", "A4.B.1", "A4.B.2", "A4.B.3"] },
];

/** Sheet numbers compare as the drawing prints them, ignoring spacing and case. */
function sameSheetNumber(a: string, b: string): boolean {
  return a.replace(/[\s.]+/g, "").toUpperCase() === b.replace(/[\s.]+/g, "").toUpperCase();
}

/**
 * Reviewed answer keys, read from OUTSIDE the repository.
 *
 * The sheets are a client's drawings and a key is derived from one, so it is
 * treated the same way: read from `REAL_PLAN_KEYS`, never committed. With no
 * folder set, every sheet reports exactly as it did before — a missing key is
 * not a failure, it is a sheet nobody has reviewed yet.
 */
const KEYS_DIR = process.env.REAL_PLAN_KEYS ?? "";

function loadKeys(): Map<string, AnswerKey> {
  const out = new Map<string, AnswerKey>();
  if (KEYS_DIR === "") return out;
  let names: string[];
  try {
    names = readdirSync(KEYS_DIR).filter((f) => f.toLowerCase().endsWith(".json"));
  } catch {
    return out;
  }
  for (const name of names) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(KEYS_DIR, name), "utf8"));
    } catch {
      continue;
    }
    const key = answerKeyFromJson(parsed);
    // A key that does not parse is SKIPPED LOUDLY rather than ignored: half a
    // key would grade a run against the wrong numbers and nothing downstream
    // could tell.
    if (key === null) {
      // eslint-disable-next-line no-console -- this eval's output IS its report.
      console.log(`  !! ${name} is not a readable answer key and was skipped`);
      continue;
    }
    out.set(key.sheet.number.replace(/[\s.]+/g, "").toUpperCase(), key);
  }
  return out;
}

const KEYS = loadKeys();

function keyFor(sheetNumber: string): AnswerKey | null {
  return KEYS.get(sheetNumber.replace(/[\s.]+/g, "").toUpperCase()) ?? null;
}

const SHEETS = (process.env.REAL_PLAN_SHEETS ?? "")
  .split(";")
  .map((part) => part.trim())
  .filter((part) => part.includes(":"))
  .map((part) => {
    const [key, pages] = part.split(":");
    return {
      key: key.trim(),
      pages: pages
        .split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    };
  });

type Picked = {
  page: number;
  number: string;
  title: string;
  segments: number;
};

type SheetReport = {
  set: string;
  page: number;
  number: string;
  title: string;
  scale: string;
  scaleHow: string;
  feetPerUnit: number | null;
  views: { name: string; scale: string | null; feet: number; runs: number }[];
  totalFeet: number;
  runs: number;
  clusters: { inches: number; feet: number; runs: number }[];
  layers: { layer: string; feet: number }[];
  printedDims: number;
  gridDropped: number;
  duplicateDropped: number;
  /** Set when the finder REFUSED this sheet rather than measuring it. */
  refused: string;
  /** How many strokes it carried, which is why it was refused. */
  segmentCount: number;
  /** How long the whole sheet took, read end to end. */
  ms: number;
  /** Graded against a reviewed key, when one exists for this sheet. */
  score: KeyScore | null;
  keyBy: string;
  /** The overlay's file name under REAL_PLAN_OUT, when one was written. */
  overlay: string;
};


/**
 * An SVG overlay: the drawing's own strokes in grey, the runs the finder
 * claimed in red, over white.
 *
 * Both layers, deliberately. `realPlan.eval.ts`'s overlay draws only the
 * claimed walls, which answers "what did it find" and not "what did it miss" —
 * and on a real sheet the second question is the one with the money in it. Red
 * over grey shows a missed wall as a grey line with nothing on it, and a
 * phantom as a red line over furniture.
 *
 * SVG and not PNG, as that file says: no raster dependency, and it opens
 * beside the PDF at any zoom.
 *
 * ── THIS IS DRAWING CONTENT, SO IT IS WRITTEN OUTSIDE THE REPOSITORY ──
 *
 * `REAL_PLAN_OUT` defaults under the system temporary directory and the report
 * says where it went. Nothing here is committed and no fixture is derived from
 * it.
 */
function overlaySvg(
  segments: readonly StrokeSegment[],
  walls: readonly { x1: number; y1: number; x2: number; y2: number }[],
  page: { widthPt: number; heightPt: number },
  scale: number,
): string {
  const grey = segments
    .map(
      (g) =>
        `<line x1="${g.x1.toFixed(1)}" y1="${g.y1.toFixed(1)}" x2="${g.x2.toFixed(1)}" y2="${g.y2.toFixed(1)}"/>`,
    )
    .join("");
  const red = walls
    .map(
      (w) =>
        `<line x1="${(w.x1 * scale).toFixed(1)}" y1="${(w.y1 * scale).toFixed(1)}" ` +
        `x2="${(w.x2 * scale).toFixed(1)}" y2="${(w.y2 * scale).toFixed(1)}"/>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.widthPt.toFixed(0)}" height="${page.heightPt.toFixed(0)}" ` +
    `viewBox="0 0 ${page.widthPt.toFixed(0)} ${page.heightPt.toFixed(0)}">\n` +
    `<rect width="100%" height="100%" fill="#fff"/>\n` +
    `<g stroke="#c9ced6" stroke-width="0.6" fill="none">${grey}</g>\n` +
    `<g stroke="#e11d48" stroke-width="2.5" fill="none" stroke-opacity="0.85">${red}</g>\n</svg>\n`
  );
}

describe.skipIf(DIR === "")("a folder of real plan sets", () => {
  it("picks the floor plans and measures them", async () => {
    const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
    expect(files.length, `no PDFs under ${DIR} — this eval would report a clean nothing`).toBeGreaterThan(0);
    mkdirSync(OUT, { recursive: true });

    const reports: SheetReport[] = [];
    const skipped: { set: string; page: number; number: string; kind: string }[] = [];
  /** Every page the reader saw, with what the PRODUCT thinks of it. */
  const ranked: { set: string; page: number; number: string; title: string; rank: SheetRank }[] = [];

    for (const file of files.sort()) {
      const bytes = readFileSync(join(DIR, file));
      const doc = await openPlanPdf(bytes);
      const label = basename(file, ".pdf");
      const named = SHEETS.find((entry) => file.includes(entry.key));
      try {
        const pages = doc.pageCount;
        const candidates: Picked[] = [];
        const fixedFor = FIXED_SHEETS.find((entry) => file.includes(entry.key));

        // ── PASS ONE: what each sheet calls itself ──
        for (let page = 1; page <= pages; page += 1) {
          if (named !== undefined && !named.pages.includes(page)) continue;
          let text;
          try {
            text = await doc.pageText(page);
          } catch {
            continue;
          }
          const { number, title } = nameSheet(
            text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, height: i.height })),
            { widthPt: text.widthPt, heightPt: text.heightPt },
          );
          const verdict = sheetSuitability(number, title, null);
          // ── IT MUST SAY "PLAN", NOT MERELY FAIL TO SAY SOMETHING ELSE ──
          //
          // `sheetSuitability` returns "floor plan" as its DEFAULT, which is
          // right in the product — a sheet it cannot place is offered to the
          // estimator with no caution rather than withheld. Here that default
          // selected every sheet whose title did not parse, which on a real set
          // is most of them. So this asks for the word as well.
          const saysPlan = /\bPLAN\b/i.test(title);
          // ── EVERY PAGE IS RANKED, WHETHER OR NOT IT IS TAKEN ──
          //
          // The comparison this report exists to show: which sheets the
          // PRODUCT would choose on its own, against the fixed list below. A
          // page skipped here is still ranked, because a ranking that only
          // sees the sheets somebody already picked proves nothing.
          ranked.push({ set: label, page, number, title, rank: takeoffRank(number, title) });

          // ── THE FIXED LIST WINS OVER EVERY RULE ──
          //
          // A sheet named in `FIXED_SHEETS` is taken whatever its title reads
          // like, because the point of a fixed denominator is that it does not
          // move when the title reader does.
          const onTheList =
            fixedFor !== undefined && fixedFor.numbers.some((want) => sameSheetNumber(want, number));
          if (onTheList) {
            candidates.push({ page, number, title, segments: 0 });
            continue;
          }
          if (fixedFor !== undefined) {
            skipped.push({ set: label, page, number, kind: "not on the fixed list" });
            continue;
          }

          // A named page is taken as given: somebody has looked at it.
          if (named === undefined && (verdict.kind !== "floor plan" || !saysPlan)) {
            skipped.push({
              set: label,
              page,
              number,
              kind: verdict.kind !== "floor plan" ? verdict.kind : "title does not say PLAN",
            });
            continue;
          }
          candidates.push({ page, number, title, segments: 0 });
        }

        // ── PASS TWO: how much is drawn on each, so the biggest plans win ──
        for (const candidate of candidates) {
          try {
            const strokes = await doc.pageStrokes(candidate.page);
            candidate.segments = strokes.segments.length;
          } catch {
            candidate.segments = 0;
          }
        }
        // A set with a fixed list takes all of it and no more — `PER_SET` is
        // about choosing, and there is nothing left to choose.
        const taken =
          fixedFor !== undefined
            ? candidates
            :
          named === undefined
            ? candidates
                .filter((c) => c.segments >= MIN_SEGMENTS)
                .sort((a, b) => b.segments - a.segments)
                .slice(0, PER_SET)
            : candidates;
        for (const thin of candidates.filter((c) => !taken.includes(c))) {
          skipped.push({
            set: label,
            page: thin.page,
            number: thin.number,
            kind: thin.segments < MIN_SEGMENTS ? `too little drawn (${thin.segments} strokes)` : "not among the biggest",
          });
        }

        // ── PASS THREE: the product's pipeline on each one ──
        for (const sheet of taken.sort((a, b) => a.page - b.page)) {
          const text = await doc.pageText(sheet.page);
          const strokes = await doc.pageStrokes(sheet.page);
          const segments = strokes.segments as StrokeSegment[];
          const pageSize = { widthPt: strokes.widthPt, heightPt: strokes.heightPt };
          const labels = dimensionLabels(text);
          const verdict = readSheetScale(text, segments, labels, {}, metricDimensionLabels(text));
          // ── THE SPLIT RUNS BEFORE THE VERDICT CAN END THE PAGE ──
          //
          // `sheetViews` reads the scale CAPTIONS and `viewRegions` reads the
          // sheet's own gutters, so neither needs a scale to run. They used to
          // sit inside `if (verdict.ok)`, which meant a sheet carrying several
          // drawings at several scales was reported as "no scale" and nothing
          // on it was measured — although every drawing on it was captioned.
          //
          // And that sheet is the one most likely to decline: `readSheetScale`
          // wants printed dimensions that AGREE, and dimensions of two
          // drawings at two scales do not agree with each other.
          const textItemsAll: SheetTextItem[] = text.items.map((i) => ({
            str: i.str,
            x: i.x,
            y: i.y,
            width: i.width,
            height: i.height,
          }));
          const allViews = viewsInRegions(
            sheetViews(textItemsAll, pageSize.widthPt),
            viewRegions(segments, pageSize),
          );

          // ── THE SAME DECISION THE APP MAKES, FROM THE SAME FUNCTION ──
          //
          // This file used to run `readSheetScale` and stop. The app runs it
          // and then falls back to the PRINTED scale, so four real sheets were
          // reported here as "no scale" that the app reads perfectly — the
          // measure understating the product it exists to measure.
          //
          // `scaleFromPrinted` gives a line and a distance rather than a
          // ratio, so the ratio is recovered from them: the line IS the
          // sheet's own width, and the distance is what the printed scale says
          // that width spans. Dividing by the page's paper inches gives feet
          // per inch, which is what `sheetScale` compares.
          const printed = scaleFromPrinted(
            printedScalesOnPage(text.items),
            text.widthPt,
            text.heightPt,
          );
          const decided = sheetScale({
            textItems: textItemsAll,
            segments,
            pageSize,
            fromDimensions: verdict.ok
              ? { ok: true, scaleName: verdict.scaleName, feetPerInch: verdict.feetPerInch }
              : { ok: false, reason: verdict.reason },
            fromPrinted:
              printed === null
                ? null
                : {
                    scaleName: printed.scaleName,
                    feetPerInch: printed.declaredDistanceFeet / (text.widthPt / 72),
                  },
          });

          const report: SheetReport = {
            set: label,
            page: sheet.page,
            number: sheet.number,
            title: sheet.title.replace(/\s+/g, " ").slice(0, 70),
            scale: verdict.ok ? `${verdict.feetPerInch} ft/in` : "DECLINED",
            scaleHow: verdict.ok
              ? `${verdict.scaleName}, ${verdict.agreed.length} agreeing of ${verdict.considered}`
              : verdict.reason.slice(0, 90),
            feetPerUnit: null,
            views: [],
            totalFeet: 0,
            runs: 0,
            clusters: [],
            layers: [],
            printedDims: labels.length,
            gridDropped: 0,
            duplicateDropped: 0,
            refused: "",
            segmentCount: 0,
            ms: 0,
            score: null,
            keyBy: "",
            overlay: "",
          };
          // A PRINTED scale is the app's own fallback and the report used to
          // lack it — four real sheets were called "no scale" here that the app
          // reads perfectly. Recorded as its own source, never dressed as a
          // dimension-derived one.
          if (!verdict.ok && decided.kind === "PRINTED") {
            report.scale = `${decided.feetPerInch.toFixed(2)} ft/in`;
            report.scaleHow = `${decided.scaleName} printed on the sheet — nothing confirms it`;
          }

          const sheetStarted = Date.now();
          // What this sheet ends up reporting, from whichever branch ran — the
          // sheet-wide scale or the per-view one. Collected so a key can grade
          // either without the grading code knowing which happened.
          let reportedWalls: readonly WallCandidate[] = [];
          // DIMENSIONS or PRINTED both give the sheet ONE scale, and from here
          // the two are measured identically — `report.scale` above is what
          // records which it was.
          const sheetWide =
            decided.kind === "DIMENSIONS" || decided.kind === "PRINTED" ? decided.feetPerInch : null;
          if (sheetWide !== null) {
            const feetPerUnit = feetPerUnitFrom(sheetWide, text.widthPt);
            report.feetPerUnit = feetPerUnit;
            const textItems = textItemsAll;
            const input = { segments, textItems, pageSize, feetPerUnit, wallTypes: [], sampledSheets: null };
            const views = allViews;
            // ── A REAL SHEET CAN BE REFUSED OUTRIGHT, AND THAT IS A RESULT ──
            //
            // `wallsFromStrokes` throws `SheetTooDenseError` past
            // `MAX_PAIR_TESTS`, which is about 8,900 wall-length lines. The
            // twenty fixtures carry a few hundred; the first real set hit
            // 12,179 and took the whole run down with it. A refusal is one of
            // the outcomes this report exists to count, so it is caught per
            // sheet and recorded rather than being allowed to end the pass.
            let found: ReturnType<typeof findWallsOnSheet>;
            try {
              found = findWallsOnSheet(input);
            } catch (err) {
              report.refused = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
              report.segmentCount = segments.length;
              report.ms = Date.now() - sheetStarted;
          // ── AND GRADED, IF SOMEBODY HAS REVIEWED THIS SHEET ──
          //
          // Keyed on the sheet NUMBER rather than the page, so a re-exported
          // set does not orphan the work. A sheet with no key is reported
          // exactly as before — the key adds an error bar where one exists and
          // claims nothing where one does not.
          const key = keyFor(sheet.number);
          if (key !== null && report.totalFeet > 0) {
            report.score = scoreAgainstKey(
              reportedWalls.map((w) => ({
                x1: w.x1,
                y1: w.y1,
                x2: w.x2,
                y2: w.y2,
                lengthFeet: w.lengthFeet,
              })),
              key,
            );
            report.keyBy = `${key.reviewedBy}, ${key.reviewedAt.slice(0, 10)}`;
          }
          reports.push(report);
              continue;
            }
            if (views.length >= 2) {
              let measured: ReturnType<typeof wallsPerView>;
              try {
                measured = wallsPerView({ ...input, views });
              } catch (err) {
                report.refused = `per-view: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`;
                measured = [];
              }
              const picked = primaryView(measured);
              if (picked.primary) found = picked.primary.found;
              report.views = [
                ...(picked.primary
                  ? [
                      {
                        name: picked.primary.view.name,
                        scale: picked.primary.view.scaleName,
                        feet: picked.primary.found.walls.reduce((n, w) => n + w.lengthFeet, 0),
                        runs: picked.primary.found.walls.length,
                      },
                    ]
                  : []),
                ...picked.others.map((other) => ({
                  name: other.view.name,
                  scale: other.view.scaleName,
                  feet: other.found.walls.reduce((n, w) => n + w.lengthFeet, 0),
                  runs: other.found.walls.length,
                })),
              ];
            }
            reportedWalls = found.walls;
            report.totalFeet = found.walls.reduce((n, w) => n + w.lengthFeet, 0);
            report.runs = found.walls.length;
            report.gridDropped = found.gridDropped;
            report.duplicateDropped = found.duplicateDropped;
            report.clusters = clusterByThickness(found.walls).map((c) => ({
              inches: c.inches,
              feet: c.feet,
              runs: c.runs.length,
            }));
            // WHAT THE DRAWING CALLS ITS OWN LINES, where it says so at all.
            // A real export often carries no optional-content groups, and the
            // report has to be readable when it does not — so this is a column
            // that is sometimes empty rather than a thing the report needs.
            const byLayer = new Map<string, number>();
            for (const segment of segments) {
              const layer = segment.layer ?? "";
              if (layer === "") continue;
              const feet = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) * (feetPerUnit / pageSize.widthPt);
              byLayer.set(layer, (byLayer.get(layer) ?? 0) + feet);
            }
            report.layers = [...byLayer.entries()]
              .map(([layer, feet]) => ({ layer, feet }))
              .sort((a, b) => b.feet - a.feet)
              .slice(0, 8);

            // The runs arrive in page-width units; the strokes are in points.
            const svg = `${label.replace(/[^A-Za-z0-9_-]+/g, "_")}-p${sheet.page}.svg`;
            writeFileSync(
              join(OUT, svg),
              overlaySvg(segments, found.walls, pageSize, pageSize.widthPt),
              "utf8",
            );
            report.overlay = svg;
          } else {
            // ── THE SHEET HAS NO SCALE; ITS DRAWINGS STILL MIGHT ──
            //
            // Reached only when the printed dimensions have already declined,
            // because a dimension can be checked against the drawing and a
            // caption cannot. What it recovers is the sheet that declined
            // BECAUSE it carries several drawings: dimensions of two drawings
            // at two scales do not agree with each other, so the better the
            // sheet is laid out, the more certainly it was refused.
            //
            // Each view is measured at its OWN caption, absolutely — a caption
            // is feet per paper inch and needs no anchor — so this does not
            // depend on any view being trusted first.
            const scaled = viewsWithOwnScale(allViews, pageSize.widthPt);
            const measured: { name: string; scale: string | null; feet: number; runs: number }[] = [];
            const allWalls: WallCandidate[] = [];
            let totalFeet = 0;
            let totalRuns = 0;
            for (const { view, feetPerUnit } of scaled) {
              const inView = segments.filter((one) => {
                const mx = (one.x1 + one.x2) / 2 / pageSize.widthPt;
                const my = (one.y1 + one.y2) / 2 / pageSize.widthPt;
                // `insideView` and not the view's RANGE — see its header. The
                // range is a bounding box, and testing it here measured A120
                // at 217 ft where the app measured 121.
                return insideView(view, mx, my);
              });
              if (inView.length === 0) continue;
              try {
                const found = findWallsOnSheet({
                  segments: inView as StrokeSegment[],
                  textItems: textItemsAll,
                  pageSize,
                  feetPerUnit,
                  wallTypes: [],
                  sampledSheets: null,
                });
                const feet = found.walls.reduce((n, w) => n + w.lengthFeet, 0);
                allWalls.push(...found.walls);
                measured.push({ name: view.name, scale: view.scaleName, feet, runs: found.walls.length });
                totalFeet += feet;
                totalRuns += found.walls.length;
              } catch (err) {
                report.refused = `per-view: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`;
              }
            }
            reportedWalls = allWalls;
            if (measured.length > 0) {
              // AN OVERLAY FOR THIS PATH TOO. A sheet measured from its view
              // captions is the one most worth LOOKING at — it is the weaker
              // evidence — and it was the only path that produced no picture.
              const svg = `${label.replace(/[^A-Za-z0-9_-]+/g, "_")}-p${sheet.page}.svg`;
              writeFileSync(
                join(OUT, svg),
                overlaySvg(segments, allWalls, pageSize, pageSize.widthPt),
                "utf8",
              );
              report.overlay = svg;
              report.views = measured;
              report.totalFeet = totalFeet;
              report.runs = totalRuns;
              // SAID OUT LOUD, because a number read off a caption is weaker
              // evidence than one read off a dimension and a report that hides
              // which it used is a report nobody can weigh.
              report.scale = "FROM VIEW CAPTIONS";
              report.scaleHow = `${measured.length} view${measured.length === 1 ? "" : "s"} measured at their own captioned scale`;
            }
          }
          report.ms = Date.now() - sheetStarted;
          // ── GRADED, IF SOMEBODY HAS REVIEWED THIS SHEET ──
          //
          // Keyed on the sheet NUMBER rather than the page, so a re-exported
          // set does not orphan the work. A sheet with no key reports exactly
          // as before: the key adds an error bar where one exists and claims
          // nothing where one does not.
          const key = keyFor(sheet.number);
          if (key !== null) {
            report.score = scoreAgainstKey(
              reportedWalls.map((w) => ({
                x1: w.x1,
                y1: w.y1,
                x2: w.x2,
                y2: w.y2,
                lengthFeet: w.lengthFeet,
              })),
              key,
            );
            report.keyBy = `${key.reviewedBy}, ${key.reviewedAt.slice(0, 10)}`;
          }
          reports.push(report);
        }
      } finally {
        await doc.close();
      }
    }

    // ── THE REPORT ──
    const lines: string[] = [];
    const say = (line: string) => {
      lines.push(line);
      console.log(line);
    };

    say(`# real-plan report — ${files.length} sets, ${reports.length} floor plans measured`);
    say("");
    for (const r of reports) {
      say(`## ${r.set}  p${r.page}  [${r.number}]`);
      say(`   title        ${r.title}`);
      say(`   scale        ${r.scale}   (${r.scaleHow})`);
      say(`   printed dims ${r.printedDims}`);
      if (r.refused !== "") {
        say(`   walls        REFUSED — ${r.refused}`);
        say(`   strokes      ${r.segmentCount}`);
        say("");
        continue;
      }
      // A SHEET MEASURED FROM ITS VIEWS HAS NO SINGLE `feetPerUnit`, and that
      // is the point of it — each drawing was measured at its own caption. So
      // "was anything measured" is the view list, not the sheet's scale.
      if (r.feetPerUnit === null && r.views.length === 0) {
        say(`   walls        NOT MEASURED — no scale`);
        say("");
        continue;
      }
      say(`   walls        ${r.totalFeet.toFixed(0)} ft over ${r.runs} runs   (${r.ms} ms)`);
      if (r.score !== null) {
        const s = r.score;
        // ── THE ONLY LINE IN THIS REPORT WITH AN ERROR BAR ──
        //
        // Everything else here is what the detector said. This is what a
        // person said, and the difference between them.
        say(
          `   KEY          ${s.keyFeet.toFixed(0)} ft reviewed by ${r.keyBy}` +
            `   found ${s.foundFeet.toFixed(0)} ft   ${s.errorPercent >= 0 ? "+" : ""}${s.errorPercent.toFixed(1)}%`,
        );
        const missedBig = s.missed.slice(0, 5).map((w) => `${w.lengthFeet.toFixed(0)}ft(${w.from})`);
        const extraBig = s.extra.slice(0, 5).map((w) => `${w.lengthFeet.toFixed(0)}ft`);
        say(
          `     missed     ${String(s.missed.length).padStart(3)} walls / ${s.missedFeet.toFixed(0).padStart(5)} ft` +
            (missedBig.length > 0 ? `   biggest: ${missedBig.join(" ")}` : ""),
        );
        say(
          `     extra      ${String(s.extra.length).padStart(3)} walls / ${s.extraFeet.toFixed(0).padStart(5)} ft` +
            (extraBig.length > 0 ? `   biggest: ${extraBig.join(" ")}` : ""),
        );
        // How the DRAWING showed the walls somebody confirmed — the question
        // the single-line measurement could not answer without a key.
        say(
          `     key walls  ${s.keyFromPairs} drawn as a pair, ${s.keyFromSingles} as a single line` +
            ` (${s.keyFeetFromSingles.toFixed(0)} ft)`,
        );
      }
      if (r.views.length > 0) {
        for (const v of r.views) {
          say(`     view       ${v.name} @ ${v.scale ?? "?"} — ${v.feet.toFixed(0)} ft, ${v.runs} runs`);
        }
      }
      say(
        `   thickness    ${r.clusters
          .slice(0, 8)
          .map((c) => `${c.inches.toFixed(2)}in ${c.feet.toFixed(0)}ft n=${c.runs}`)
          .join(" | ")}`,
      );
      say(`   dropped      grid ${r.gridDropped}, duplicate-coverage ${r.duplicateDropped}`);
      if (r.overlay !== "") say(`   overlay      ${r.overlay}`);
      if (r.layers.length > 0) {
        say(`   layers       ${r.layers.map((l) => `${l.layer} ${l.feet.toFixed(0)}ft`).join(" | ")}`);
      } else {
        say(`   layers       NONE — the export names no layers, so nothing can lean on them`);
      }
      say("");
    }

    // ── WHAT THE PRODUCT WOULD CHOOSE ON ITS OWN ──
    //
    // The fixed list is the denominator; this is the check on whether the
    // app's own ranking finds those sheets without being told. It is the
    // question the stroke-count ranking got wrong — it preferred the LIFE
    // SAFETY plans, which are denser than the floor plans they are drawn over.
    say("# what `takeoffRank` would pick, per set — the product's own choice");
    const bySet = new Map<string, typeof ranked>();
    for (const one of ranked) {
      const list = bySet.get(one.set);
      if (list) list.push(one);
      else bySet.set(one.set, [one]);
    }
    for (const [set, pages] of bySet) {
      const best = [...pages].sort((a, b) => b.rank.score - a.rank.score || a.page - b.page);
      const wanted = FIXED_SHEETS.find((entry) => set.includes(entry.key));
      say(`  ${set}`);
      for (const one of best.slice(0, 8)) {
        const onList =
          wanted !== undefined && wanted.numbers.some((want) => sameSheetNumber(want, one.number));
        say(
          `    ${String(one.rank.score).padStart(4)}  ${onList ? "ON LIST " : "        "}` +
            `[${one.number}] p${one.page}  ${one.title.replace(/\s+/g, " ").slice(0, 46)}` +
            `   (${one.rank.why})`,
        );
      }
      if (wanted !== undefined) {
        const missing = wanted.numbers.filter(
          (want) => !pages.some((one) => sameSheetNumber(want, one.number)),
        );
        if (missing.length > 0) say(`    NOT FOUND IN THIS FILE: ${missing.join(", ")}`);
      }
      say("");
    }

    say(`# skipped ${skipped.length} sheets, by what their own title block says`);
    const byKind = new Map<string, number>();
    for (const s of skipped) byKind.set(s.kind.replace(/\(\d+ strokes\)/, "(n strokes)"), (byKind.get(s.kind.replace(/\(\d+ strokes\)/, "(n strokes)")) ?? 0) + 1);
    for (const [kind, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) say(`   ${String(n).padStart(4)}  ${kind}`);

    writeFileSync(join(OUT, "report.txt"), `${lines.join("\n")}\n`, "utf8");
    writeFileSync(join(OUT, "skipped.txt"), skipped.map((s) => `${s.set} p${s.page} [${s.number}] ${s.kind}`).join("\n"), "utf8");
    console.log(`\n# written to ${OUT}`);

    expect(reports.length, "no floor plan was measured in any set").toBeGreaterThan(0);
  }, 1_800_000);
});
