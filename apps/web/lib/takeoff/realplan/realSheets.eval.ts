import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { dimensionLabels, metricDimensionLabels } from "../../plan-ingest/dimensionLabels";
import { readSheetScale } from "../scaleFromDimensions";
import { findWallsOnSheet, type SheetTextItem } from "../findWallsOnSheet";
import { sheetSuitability } from "../sheetSuitability";
import { nameSheet } from "./nameSheet";
import { primaryView, sheetViews, viewRegions, viewsInRegions, wallsPerView } from "../sheetViews";
import { clusterByThickness, type StrokeSegment } from "../wallVectors";

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

    for (const file of files.sort()) {
      const bytes = readFileSync(join(DIR, file));
      const doc = await openPlanPdf(bytes);
      const label = basename(file, ".pdf");
      const named = SHEETS.find((entry) => file.includes(entry.key));
      try {
        const pages = doc.pageCount;
        const candidates: Picked[] = [];

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
        const taken =
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
            overlay: "",
          };

          if (verdict.ok) {
            const feetPerUnit = (text.widthPt / 72) * verdict.feetPerInch;
            report.feetPerUnit = feetPerUnit;
            const textItems: SheetTextItem[] = text.items.map((i) => ({
              str: i.str,
              x: i.x,
              y: i.y,
              width: i.width,
              height: i.height,
            }));
            const input = { segments, textItems, pageSize, feetPerUnit, wallTypes: [], sampledSheets: null };
            const views = viewsInRegions(sheetViews(textItems, pageSize.widthPt), viewRegions(segments, pageSize));
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
      if (r.feetPerUnit === null) {
        say(`   walls        NOT MEASURED — no scale`);
        say("");
        continue;
      }
      say(`   walls        ${r.totalFeet.toFixed(0)} ft over ${r.runs} runs`);
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
