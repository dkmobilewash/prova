import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet, inPageWidthUnits, type SheetTextItem } from "../findWallsOnSheet";
import { drawingRegions, segmentsInRegions } from "../planRegion";
import { sheetViews, viewRegions, viewsInRegions } from "../sheetViews";
import { clusterByThickness, type StrokeSegment, type WallCandidate } from "../wallVectors";

/**
 * ── A HELD-OUT PLAN, SCORED ONCE ──
 *
 *     HELDOUT_PDF="/path/to/plan.pdf" \
 *       pnpm --filter @prova/web exec vitest run \
 *         --config vitest.eval.config.mts lib/takeoff/realplan/zzHeldout.eval.ts
 *
 * It reads ONE pdf named by the environment and reports what the product's own
 * pipeline finds on it. It does NOT read any answer key, and nothing in
 * `lib/takeoff` may: `truthWall.test.ts` is what keeps that true for the
 * twenty fixtures and now for this plan as well.
 *
 * The scoring against the key is done OUTSIDE the engine, by a person or a
 * script that has read the key. That separation is the whole value of a
 * held-out test: a detector that can see the answer is not being measured.
 *
 * The drawing stays outside the repository, like every real plan here.
 */

const PDF = process.env.HELDOUT_PDF ?? "";
const PAGE = Number(process.env.HELDOUT_PAGE ?? "1");
/** Feet per paper inch. 1/4" = 1'-0" is 4. */
const FEET_PER_INCH = Number(process.env.HELDOUT_FEET_PER_INCH ?? "4");

describe.skipIf(PDF === "")("a held-out plan, through the product's pipeline", () => {
  it(
    "reports what it finds, and nothing about any key",
    async () => {
      const bytes = readFileSync(PDF);
      expect(bytes.length, "the pdf is empty").toBeGreaterThan(1000);
      const pdf = await openPlanPdf(bytes);
      const text = await pdf.pageText(PAGE);
      const strokes = await pdf.pageStrokes(PAGE);
      const segments = strokes.segments as StrokeSegment[];
      const size = { widthPt: strokes.widthPt, heightPt: strokes.heightPt };
      const textItems: SheetTextItem[] = text.items.map((i) => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      }));

      console.log(
        `\n=== ${PDF.split("/").pop()} p${PAGE} ===\n` +
          `  ${size.widthPt.toFixed(0)} x ${size.heightPt.toFixed(0)} pt ` +
          `(${(size.widthPt / 72).toFixed(1)} x ${(size.heightPt / 72).toFixed(1)} in), ` +
          `${segments.length} strokes, ${textItems.length} text items`,
      );

      const regions = viewRegions(segments, size);
      const views = viewsInRegions(sheetViews(textItems, size.widthPt), regions);
      console.log(`  views captioned: ${views.length}`);
      for (const view of views) {
        console.log(`    "${view.name}" ${view.scaleName ?? "no scale"}`);
      }

      // The product's own clip for a one-drawing sheet.
      const drawing = drawingRegions(regions, segments, size.widthPt);
      const onTheDrawing = segmentsInRegions(segments, drawing, size.widthPt);
      console.log(
        `  regions ${regions.length}, kept ${drawing.length}, ` +
          `strokes ${segments.length} -> ${onTheDrawing.length}`,
      );

      const feetPerUnit = (size.widthPt / 72) * FEET_PER_INCH;
      const stages: string[] = [];
      const found = findWallsOnSheet({
        onStage: (name, ms) => stages.push(`${name} ${ms}ms`),
        segments: onTheDrawing as StrokeSegment[],
        textItems,
        pageSize: size,
        feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });
      // ── WHERE THE CURVED RUNS GO, STAGE BY STAGE ──
      //
      // Both engines receive the same strokes, so "the pairer ate the chords"
      // is not the explanation it looked like. This follows the curved
      // candidates through the filters instead of assuming which one removes
      // them.
      const curvedIn = (list: readonly WallCandidate[]) =>
        list.filter((one) => one.curved === true);
      const feetOf = (list: readonly WallCandidate[]) =>
        list.reduce((n, one) => n + one.lengthFeet, 0);
      console.log(
        `\n  CURVED candidates by stage:` +
          `\n    from the engines   ${curvedIn(found.everywhere).length} runs, ${feetOf(curvedIn(found.everywhere)).toFixed(1)} ft` +
          `\n    not lettering      ${curvedIn(found.notLettering).length} runs, ${feetOf(curvedIn(found.notLettering)).toFixed(1)} ft` +
          `\n    not the border     ${curvedIn(found.notBorder).length} runs, ${feetOf(curvedIn(found.notBorder)).toFixed(1)} ft` +
          `\n    in the building    ${curvedIn(found.inBuilding).length} runs, ${feetOf(curvedIn(found.inBuilding)).toFixed(1)} ft` +
          `\n    final              ${curvedIn(found.walls).length} runs, ${feetOf(curvedIn(found.walls)).toFixed(1)} ft`,
      );

      console.log(`\n  stages: ${stages.join(", ")}`);

      // ── EVERY CURVED RUN, AND THE GAPS BETWEEN THEM ──
      //
      // The arcs on this plan carry windows, so an opening breaks the drawn
      // arc and each piece assembles as its own chain. That would explain both
      // the fragment count and a total near the NET rather than the gross —
      // and it is checkable rather than a story: the gaps should be the width
      // of a window.
      const curvedRuns = found.walls.filter((one) => one.curved === true);
      console.log(`\n  the ${curvedRuns.length} curved runs, in feet:`);
      for (const one of curvedRuns) {
        console.log(
          `    ${one.lengthFeet.toFixed(2).padStart(6)} ft  ` +
            `${(one.thicknessFeet * 12).toFixed(2).padStart(6)} in  ` +
            `(${(one.x1 * feetPerUnit).toFixed(1)},${(one.y1 * feetPerUnit).toFixed(1)}) -> ` +
            `(${(one.x2 * feetPerUnit).toFixed(1)},${(one.y2 * feetPerUnit).toFixed(1)})`,
        );
      }

      const walls = found.walls;

      // What the pipeline removed before pairing, so a "no phantoms" result
      // can be read as "the filters worked" rather than "there was nothing to
      // filter".
      console.log(
        `\n  removed before pairing: ${found.layerDropped} by layer, ` +
          `${found.gridDropped} into grid bubbles, ${found.templateDropped} by template, ` +
          `${found.hatchDropped} with nothing drawn along them`,
      );
      const bubbleish = textItems.filter((t) => /^[A-Z]$|^\d{1,2}$/.test(t.str.trim()));
      console.log(`  text items that look like grid bubbles: ${bubbleish.length}`);

      console.log("\n  by thickness:");
      for (const cluster of clusterByThickness(walls).slice(0, 12)) {
        console.log(
          `    ${cluster.inches.toFixed(2).padStart(6)} in  ` +
            `${String(cluster.runs.length).padStart(3)} runs  ${cluster.feet.toFixed(1).padStart(7)} ft`,
        );
      }

      // ── EVERY RUN, SO A PERSON WITH THE KEY CAN MATCH THEM UP ──
      //
      // Printed as plain geometry in FEET from the sheet's bottom-left, which
      // is what an answer key states positions in. Nothing here reads a key.
      const deg = (w: WallCandidate) => {
        const a = (Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180) / Math.PI;
        return ((a % 180) + 180) % 180;
      };
      console.log("\n  every run — x1,y1 to x2,y2 in FEET, length, thickness, angle:");
      const rows = [...walls].sort((a, b) => b.lengthFeet - a.lengthFeet);
      for (const w of rows) {
        console.log(
          `    ${(w.x1 * feetPerUnit).toFixed(1).padStart(7)},${(w.y1 * feetPerUnit).toFixed(1).padStart(7)}` +
            ` -> ${(w.x2 * feetPerUnit).toFixed(1).padStart(7)},${(w.y2 * feetPerUnit).toFixed(1).padStart(7)}` +
            `   ${w.lengthFeet.toFixed(1).padStart(6)} ft` +
            `   ${(w.thicknessFeet * 12).toFixed(2).padStart(6)} in` +
            `   ${deg(w).toFixed(0).padStart(4)}deg` +
            `${w.curved === true ? "   CURVED" : ""}`,
        );
      }

      // An overlay to look at, written outside the repository.
      const out = process.env.HELDOUT_OUT ?? "";
      const stem = (PDF.split("/").pop() ?? "plan").replace(/\.pdf$/i, "");
      if (out !== "") {
        const { mkdirSync, writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        mkdirSync(out, { recursive: true });
        const w = size.widthPt;
        const h = size.heightPt;
        const ink = segments
          .map(
            (g) =>
              `<line x1="${g.x1.toFixed(1)}" y1="${g.y1.toFixed(1)}" x2="${g.x2.toFixed(1)}" y2="${g.y2.toFixed(1)}"/>`,
          )
          .join("");
        const runs = walls
          .map(
            (one) =>
              `<line x1="${(one.x1 * w).toFixed(1)}" y1="${(one.y1 * w).toFixed(1)}" ` +
              `x2="${(one.x2 * w).toFixed(1)}" y2="${(one.y2 * w).toFixed(1)}"/>`,
          )
          .join("");
        writeFileSync(
          // NAMED AFTER ITS INPUT, not after any one plan. A held-out eval
          // that spells out which drawing it is for has started to be about
          // that drawing — and `truthWall.test.ts` refuses it, which is how
          // this line was caught.
          join(out, `${stem}-found.svg`),
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" ` +
            `viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}">\n` +
            `<rect width="100%" height="100%" fill="#fff"/>\n` +
            `<g stroke="#c9ced6" stroke-width="0.6" fill="none">${ink}</g>\n` +
            `<g stroke="#e11d48" stroke-width="2.5" fill="none" stroke-opacity="0.85">${runs}</g>\n</svg>\n`,
          "utf8",
        );
        console.log(`\n  overlay written to ${out}/${stem}-found.svg`);
      }

      // The runs as plain JSON in FEET, for a scorer that has the key to read.
      // Written outside the repository, like everything else about this plan.
      const jsonTo = process.env.HELDOUT_JSON ?? "";
      if (jsonTo !== "") {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(
          jsonTo,
          JSON.stringify(
            walls.map((one) => ({
              x1: one.x1 * feetPerUnit,
              y1: one.y1 * feetPerUnit,
              x2: one.x2 * feetPerUnit,
              y2: one.y2 * feetPerUnit,
              lengthFeet: one.lengthFeet,
              thicknessIn: one.thicknessFeet * 12,
              curved: one.curved === true,
            })),
            null,
            1,
          ),
          "utf8",
        );
        console.log(`  runs written to ${jsonTo}`);
      }

      void inPageWidthUnits;
      await pdf.close();
    },
    600_000,
  );
});
