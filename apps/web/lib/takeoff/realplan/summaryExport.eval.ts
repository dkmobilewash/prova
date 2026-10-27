import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetNumberFrom } from "../../plan-ingest/sheetNumber";
import { detectForSheet } from "../offeredCandidates";
import { printedScalesOnPage } from "../printedScales";
import { roomBoundary } from "../roomBoundary";
import { roomsFromWalls } from "../roomsFromWalls";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { takeoffSummary, takeoffSummaryCsv, type SummaryMeasurement, type SummarySheet, type SummaryWallType } from "../summaryExport";
import { takeoffSummaryPdf } from "../summaryPdf";
import { settledType, verdictFor } from "../wallGroups";
import type { MatchableWallType } from "../wallTypeMatch";
import { inchLabel, SheetTooDenseError, type WallCandidate } from "../wallVectors";

/**
 * ── THE TAKEOFF SUMMARY EXPORT ON A REAL SET: the files an estimator would get ──
 *
 * The app's walkthrough, stood in for by code, on one TRAINING set:
 *
 *   1. the estimator adds their wall types (a JSON kept OUTSIDE git beside the
 *      plans — codes, thickness, height, sides, stud spacing);
 *   2. opens each floor plan they are taking off (`SUMMARY_EVAL_PAGES`), with
 *      the scale read from what the sheet prints, never set by hand;
 *   3. presses Find the walls, then Add on every group that is a wall —
 *      "Add as <type> — priced" where the viewer's verdict names a type,
 *      "Add these" otherwise. Groups sitting in the title block are the one
 *      judgement stood in for: not added;
 *   4. presses Find the rooms and saves them as areas (without reading the
 *      reflected ceiling plan, so the ceilings table says every room is
 *      without a type — the app's RCP read runs in the browser).
 *
 * Then the same builders the route uses (`takeoffSummary`, the CSV, the PDF)
 * write the files. No items, and no door schedule (reading one calls a
 * model — not spent).
 *
 *   REAL_PLAN_DIR="…/real-plans/new" SUMMARY_EVAL_SET="2025.07.08_Baker_EOC_BID.pdf" \
 *   SUMMARY_EVAL_PAGES="13" SUMMARY_EVAL_LIBRARY="…/shots/takeoff-export/baker-library.json" \
 *   SUMMARY_EVAL_OUT="…/shots/takeoff-export" \
 *   node_modules/.bin/vitest run --config vitest.eval.config.mts lib/takeoff/realplan/summaryExport.eval.ts
 *
 * Training sets only: the held-out sets are named in `heldOutSets.ts` and
 * BOARD.md and this eval refuses them.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.SUMMARY_EVAL_SET ?? "";
const OUT = process.env.SUMMARY_EVAL_OUT ?? "";
const LIBRARY = process.env.SUMMARY_EVAL_LIBRARY ?? "";
/** The floor plans the estimator opens, 1-based. */
const PAGES = (process.env.SUMMARY_EVAL_PAGES ?? "").split(",").map(Number).filter((n) => n > 0);
const HELD_OUT = /central.?bank|gen.?bbq|\bSLN\b|STEM|lodi|pavilion|nall|fairchild|albany|oreilly|jefferson/i;
/** A group whose every run lies right of this fraction of the width sits in
 *  the title block; the estimator does not add the logo as a wall. */
const TITLE_BLOCK_X = 0.75;

type LibraryType = { code: string; name: string; thicknessIn: number; sides: number; studSpacingIn: number; layers: number };

describe.skipIf(DIR === "" || SET === "" || PAGES.length === 0)("takeoff summary export on one set", () => {
  it("builds the CSV and the PDF from what the estimator would add on the floor plans", async () => {
    expect(HELD_OUT.test(SET), `${SET} is held out`).toBe(false);
    const library = LIBRARY === "" ? { defaultHeightFt: null, types: [] as LibraryType[] } : (JSON.parse(readFileSync(LIBRARY, "utf8")) as { defaultHeightFt: number | null; types: LibraryType[] });
    const matchable: MatchableWallType[] = library.types.map((t) => ({ id: t.code, code: t.code, name: t.name, hasParts: t.layers > 0, thicknessIn: t.thicknessIn }));
    const wallTypes: SummaryWallType[] = library.types.map((t) => ({ id: t.code, code: t.code, defaultHeightFt: library.defaultHeightFt, sides: t.sides, studSpacingIn: t.studSpacingIn }));

    const doc = await openPlanPdf(readFileSync(join(DIR, SET)));
    const sheets: SummarySheet[] = [];
    const notes: string[] = [];
    try {
      for (const page of PAGES) {
        const text = await doc.pageText(page);
        const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const reading = sheetNumberFrom(text);
        const printed = scaleFromPrinted(printedScalesOnPage(items), text.widthPt, text.heightPt);
        if (printed === null) {
          notes.push(`p${page} ${reading.sheetNumber ?? "—"}: no printed scale, nothing added`);
          continue;
        }
        const feetPerUnit = printed.declaredDistanceFeet;
        const t0 = Date.now();
        const measurements: SummaryMeasurement[] = [];
        const base = { cutouts: [], itemId: null, source: "MANUAL", roomName: null, roomNumber: null, wallRun: null, ceiling: null, feetPerUnit };
        try {
          const strokes = await doc.pageStrokes(page);
          const pairings: WallCandidate[] = [];
          const found = detectForSheet({
            segments: strokes.segments,
            textItems: items,
            pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
            feetPerUnit,
            wallTypes: matchable,
            onCandidate: (_features, wall) => pairings.push(wall),
          }).found;
          let typed = 0;
          let plain = 0;
          let skipped = 0;
          for (const group of found.groups) {
            if (group.runs.every((run) => run.x1 > TITLE_BLOCK_X && run.x2 > TITLE_BLOCK_X)) {
              skipped += 1;
              continue;
            }
            // The viewer's own rule for which type "Add as" names (`namedTypeFor`).
            const type = settledType(verdictFor(group));
            if (type) typed += 1;
            else plain += 1;
            const label = type ? `${type.code} wall — ${inchLabel(group.inches)}` : `${inchLabel(group.inches)} wall`;
            for (const run of group.runs) {
              measurements.push({
                ...base,
                kind: "LINEAR",
                xs: [run.x1, run.x2],
                ys: [run.y1, run.y2],
                label,
                wallRun: type ? { wallTypeId: type.id, heightFt: null } : null,
              });
            }
          }
          const rooms = roomsFromWalls({
            walls: roomBoundary({ pairings, runs: found.walls, drawn: [] }),
            feetPerUnit,
            text: items,
            widthPt: text.widthPt,
          });
          for (const room of rooms.rooms) {
            measurements.push({
              ...base,
              kind: "AREA",
              xs: room.xs,
              ys: room.ys,
              label: room.tag?.name ?? null,
              source: "ROOM_FINDER",
              roomName: room.tag?.name ?? null,
              roomNumber: room.tag?.number ?? null,
            });
          }
          notes.push(
            `p${page} ${reading.sheetNumber ?? "—"} ${printed.scaleName}: ${found.groups.length} groups — ${typed} added typed, ${plain} added untyped, ${skipped} in the title block not added; ` +
              `${rooms.rooms.length} rooms saved (${rooms.rooms.filter((r) => r.tag).length} named); ${Date.now() - t0} ms`,
          );
        } catch (error) {
          if (!(error instanceof SheetTooDenseError)) throw error;
          notes.push(`p${page} ${reading.sheetNumber ?? "—"}: too dense`);
        }
        sheets.push({ pageNumber: page, label: reading.sheetNumber, notFloorPlan: null, measurements });
      }
    } finally {
      await doc.close();
    }
    const summary = takeoffSummary({ sheets, wallTypes, items: [], doors: [] });
    const csv = takeoffSummaryCsv(summary);
    const t1 = Date.now();
    // Read again: pdf.js hands the first buffer to its worker, which can leave
    // it detached, and the route reads the file afresh for the PDF too.
    const pdf = await takeoffSummaryPdf(
      summary,
      { jobName: SET.replace(/\.pdf$/i, ""), fileName: SET, revisionLabel: null, exportedOn: new Date().toISOString().slice(0, 10) },
      readFileSync(join(DIR, SET)),
    );
    notes.push(`pdf: ${pdf.byteLength} bytes in ${Date.now() - t1} ms; csv: ${csv.split("\n").length - 2} lines`);
    console.log(notes.join("\n"));
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      const stem = join(OUT, SET.replace(/\.pdf$/i, ""));
      writeFileSync(`${stem}.summary.csv`, csv);
      writeFileSync(`${stem}.summary.pdf`, pdf);
      writeFileSync(`${stem}.summary.json`, JSON.stringify({ set: SET, notes, summary: { ...summary, sheets: undefined } }, null, 2));
    }
    expect(sheets.length).toBeGreaterThan(0);
  });
});
