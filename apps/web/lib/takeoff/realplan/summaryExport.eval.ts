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
import { takeoffSummary, takeoffSummaryCsv, type SummarySheet } from "../summaryExport";
import { takeoffSummaryPdf } from "../summaryPdf";
import { takeoffSheetVerdict } from "../takeoffSheet";
import { SheetTooDenseError, type WallCandidate } from "../wallVectors";

/**
 * ── THE TAKEOFF SUMMARY EXPORT ON A REAL SET: the files an estimator would get ──
 *
 * What the app's two buttons would produce for one set after "Find walls on
 * every floor plan" and "Find the rooms" on each of those sheets — the same
 * builders (`takeoffSummary`, `takeoffSummaryCsv`, `takeoffSummaryPdf`) fed by
 * the same finder, with every scale taken from what the sheet prints, never
 * set by hand. No wall-type library (so walls are named by tag or thickness
 * and carry no height or board figure), no item list, and no door schedule
 * (reading one calls a model). Writes the CSV, the PDF and a JSON of the lines
 * OUTSIDE git.
 *
 *   REAL_PLAN_DIR="…/real-plans/new" SUMMARY_EVAL_SET="2025.07.08_Baker_EOC_BID.pdf" \
 *   SUMMARY_EVAL_OUT="…/shots/takeoff-export" [SUMMARY_EVAL_PAGES="12,13"] \
 *   node_modules/.bin/vitest run --config vitest.eval.config.mts lib/takeoff/realplan/summaryExport.eval.ts
 *
 * Training sets only: the held-out sets are named in `heldOutSets.ts` and
 * BOARD.md and this eval refuses them.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.SUMMARY_EVAL_SET ?? "";
const OUT = process.env.SUMMARY_EVAL_OUT ?? "";
/** Optional: only these 1-based pages, e.g. "12,13". */
const PAGES = (process.env.SUMMARY_EVAL_PAGES ?? "").split(",").map(Number).filter((n) => n > 0);
const HELD_OUT = /central.?bank|gen.?bbq|\bSLN\b|STEM|lodi|pavilion|nall|fairchild|albany|oreilly|jefferson/i;

describe.skipIf(DIR === "" || SET === "")("takeoff summary export on one set", () => {
  it("builds the CSV and the PDF from what the finder finds on every scaled floor plan", async () => {
    expect(HELD_OUT.test(SET), `${SET} is held out`).toBe(false);
    const bytes = readFileSync(join(DIR, SET));
    const doc = await openPlanPdf(bytes);
    const sheets: SummarySheet[] = [];
    const notes: string[] = [];
    try {
      for (let page = 1; page <= doc.pageCount; page++) {
        if (PAGES.length > 0 && !PAGES.includes(page)) continue;
        const text = await doc.pageText(page);
        const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const reading = sheetNumberFrom(text);
        const verdict = takeoffSheetVerdict({ sheetNumber: reading.sheetNumber, title: reading.regionText });
        const printed = scaleFromPrinted(printedScalesOnPage(items), text.widthPt, text.heightPt);
        if (printed === null) continue;
        if (verdict.skipAutomatically) {
          notes.push(`p${page} ${reading.sheetNumber ?? "—"}: not a floor plan`);
          continue;
        }
        const feetPerUnit = printed.declaredDistanceFeet;
        const t0 = Date.now();
        try {
          const strokes = await doc.pageStrokes(page);
          const pairings: WallCandidate[] = [];
          const found = detectForSheet({
            segments: strokes.segments,
            textItems: items,
            pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
            feetPerUnit,
            onCandidate: (_features, wall) => pairings.push(wall),
          }).found;
          if (found.groups.length === 0) {
            notes.push(`p${page} ${reading.sheetNumber ?? "—"} ${printed.scaleName}: nothing found, ${Date.now() - t0} ms`);
            continue;
          }
          const rooms = roomsFromWalls({
            walls: roomBoundary({ pairings, runs: found.walls, drawn: [] }),
            feetPerUnit,
            text: items,
            widthPt: text.widthPt,
          });
          sheets.push({
            pageNumber: page,
            label: reading.sheetNumber,
            walls: found.groups,
            measurements: rooms.rooms.map((room) => ({
              kind: "AREA",
              xs: room.xs,
              ys: room.ys,
              cutouts: [],
              label: room.tag?.name ?? null,
              itemId: null,
              source: "ROOM_FINDER",
              roomName: room.tag?.name ?? null,
              roomNumber: room.tag?.number ?? null,
              feetPerUnit,
            })),
          });
          notes.push(
            `p${page} ${reading.sheetNumber ?? "—"} ${printed.scaleName}: ${found.groups.length} groups, ${rooms.rooms.length} rooms ` +
              `(${rooms.rooms.filter((r) => r.tag).length} named), ${Date.now() - t0} ms`,
          );
        } catch (error) {
          if (!(error instanceof SheetTooDenseError)) throw error;
          notes.push(`p${page} ${reading.sheetNumber ?? "—"}: too dense`);
        }
      }
    } finally {
      await doc.close();
    }
    const summary = takeoffSummary({ sheets, wallTypes: [], items: [], doors: [] });
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
