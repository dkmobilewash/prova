import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetNumberFrom } from "../../plan-ingest/sheetNumber";
import { detectForSheet } from "../offeredCandidates";
import { printedScalesOnPage } from "../printedScales";
import { scaleFromPrinted } from "../scaleFromPrinted";
import { takeoffSheetVerdict } from "../takeoffSheet";
import { SheetTooDenseError } from "../wallVectors";

/**
 * ── WHOLE-SET TAKEOFF ON A REAL SET: what it would do, sheet by sheet, and how long ──
 *
 * The planner's rule (`lib/plan-ingest/walls.ts`) over every page of one set,
 * with the scale taken from what the sheet PRINTS — never set by hand — and the
 * same detection the stage runs, timed. Answers "how many sheets, how long, and
 * what did each come to" before anybody presses the button on a customer's set.
 *
 *   REAL_PLAN_DIR="…/real-plans/new" WHOLE_SET_EVAL_SET="2025.07.08_Baker_EOC_BID.pdf" \
 *   WHOLE_SET_EVAL_OUT="…/shots/whole-set" \
 *   node_modules/.bin/vitest run --config vitest.eval.config.mts lib/takeoff/realplan/wholeSet.eval.ts
 *
 * Training sets only: the held-out sets are named in `heldOutSets.ts` and
 * BOARD.md and this eval refuses them.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.WHOLE_SET_EVAL_SET ?? "";
const OUT = process.env.WHOLE_SET_EVAL_OUT ?? "";
const HELD_OUT = /central.?bank|gen.?bbq|\bSLN\b|STEM|lodi|pavilion|nall|fairchild|albany|oreilly|jefferson/i;

type Row = {
  page: number;
  sheet: string | null;
  title: string;
  verdict: "floor plan" | "not a floor plan";
  scale: string | null;
  outcome: "walls" | "nothing found" | "too dense" | "skipped: no scale" | "skipped: not a floor plan";
  groups: number;
  feet: number;
  ms: number;
};

describe.skipIf(DIR === "" || SET === "")("whole-set takeoff on one set", () => {
  it("plans and times every sheet", async () => {
    expect(HELD_OUT.test(SET), `${SET} is held out`).toBe(false);
    const doc = await openPlanPdf(readFileSync(join(DIR, SET)));
    const rows: Row[] = [];
    const startedAll = Date.now();
    try {
      for (let page = 1; page <= doc.pageCount; page++) {
        const text = await doc.pageText(page);
        const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const reading = sheetNumberFrom(text);
        const verdict = takeoffSheetVerdict({ sheetNumber: reading.sheetNumber, title: reading.regionText });
        const printed = scaleFromPrinted(printedScalesOnPage(items), text.widthPt, text.heightPt);
        const row: Row = {
          page,
          sheet: reading.sheetNumber,
          title: reading.regionText.slice(0, 40),
          verdict: verdict.skipAutomatically ? "not a floor plan" : "floor plan",
          scale: printed?.scaleName ?? null,
          outcome: "skipped: no scale",
          groups: 0,
          feet: 0,
          ms: 0,
        };
        rows.push(row);
        if (printed === null) continue;
        if (verdict.skipAutomatically) {
          row.outcome = "skipped: not a floor plan";
          continue;
        }
        const t0 = Date.now();
        try {
          const strokes = await doc.pageStrokes(page);
          const found = detectForSheet({
            segments: strokes.segments,
            textItems: items,
            pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
            feetPerUnit: printed.declaredDistanceFeet,
          }).found;
          row.groups = found.groups.length;
          row.feet = Math.round(found.groups.reduce((sum, group) => sum + group.feet, 0));
          row.outcome = found.groups.length > 0 ? "walls" : "nothing found";
        } catch (error) {
          if (!(error instanceof SheetTooDenseError)) throw error;
          row.outcome = "too dense";
        }
        row.ms = Date.now() - t0;
      }
    } finally {
      await doc.close();
    }
    const totalMs = Date.now() - startedAll;
    const ran = rows.filter((r) => r.ms > 0);
    const lines = [
      `${SET}: ${rows.length} pages, ${ran.length} detected, ${rows.filter((r) => r.outcome === "walls").length} with walls, ` +
        `${rows.filter((r) => r.outcome === "skipped: no scale").length} no printed scale, ` +
        `${rows.filter((r) => r.outcome === "skipped: not a floor plan").length} not floor plans; ` +
        `detection ${Math.round(ran.reduce((s, r) => s + r.ms, 0) / 1000)} s total, ` +
        `max ${Math.round(Math.max(0, ...ran.map((r) => r.ms)) / 1000)} s, whole pass ${Math.round(totalMs / 1000)} s`,
      "page | sheet | title | verdict | scale | outcome | groups | feet | ms",
      ...rows.map((r) => [r.page, r.sheet ?? "—", r.title, r.verdict, r.scale ?? "—", r.outcome, r.groups, r.feet, r.ms].join(" | ")),
    ];
    console.log(lines.join("\n"));
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${SET}.txt`), lines.join("\n") + "\n");
      writeFileSync(join(OUT, `${SET}.json`), JSON.stringify({ set: SET, totalMs, rows }, null, 2));
    }
    // One row per page, and at least one page: an empty read is not a clean set.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBe(doc.pageCount);
  });
});
