import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { joinOpeningsToSchedule, widthAndHeight, type PlacedMark } from "../openingMarks";
import { openingsInWalls } from "../openings";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── HOW MANY OF A SHEET'S OPENINGS THE DOOR SCHEDULE CAN NAME ──
 *
 * Camp Bow Wow: the floor plan is A101 p8 and the door schedule is on p26. The
 * two share a mark vocabulary — `101A`, `101B`, `102`, `103` … — which is what
 * makes the join possible, and a floor plan numbers its ROOMS in the same
 * series, which is what makes it need geometry.
 *
 * ── THE SCHEDULE'S ROWS ARE READ HERE WITHOUT A MODEL, FOR THIS EVAL ONLY ──
 *
 * In the product `scheduleRows.ts` reads the table, which is a model call on a
 * page typed `SCHEDULE`. That stage has never run on this machine — there are
 * no `PlanSheetProposal` rows at all — so this eval picks the marks out of the
 * schedule page's own text to have something to join to. It is deliberately
 * crude and it is not a second reader: it produces MARKS and nothing else, so
 * the match rate it reports is a floor rather than a forecast. Where it finds
 * a size beside a mark it uses it; otherwise the row has no width and the
 * drawn gap stands, which is the product's own fallback.
 *
 *     REAL_PLAN_DIR=… npx vitest run --config vitest.eval.config.mts \
 *       lib/takeoff/realplan/zzOpeningJoin.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.JOIN_SET ?? "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf";
const PLAN_PAGE = Number(process.env.JOIN_PLAN ?? "8");
const SCHEDULE_PAGE = Number(process.env.JOIN_SCHEDULE ?? "26");
const FEET_PER_UNIT = Number(process.env.JOIN_FPU ?? "288.4866205070642");

/** `101A`, `D-12` — the same shape `zzDoorMarks.eval.ts` counts. */
const MARK = /^(?:[A-Z]{1,3}[-\s]?)?\d{1,4}[A-Z]?$/;
/** `3'-0"`, `3' - 0"` — a size cell beside a mark. */
const SIZE = /\d+\s*'\s*-?\s*\d*\s*"?/;

describe.skipIf(DIR === "")("joining a door schedule to a plan", () => {
  it("reports the match rate and the mismatches", { timeout: 1_800_000 }, async () => {
    const read = await sheetStrokes(Buffer.from(readFileSync(join(DIR, SET))), PLAN_PAGE);
    expect(read, "the plan could not be read").not.toBeNull();
    if (read === null) return;
    const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, SET))));
    const planText = await doc.pageText(PLAN_PAGE);
    const scheduleText = await doc.pageText(SCHEDULE_PAGE);
    const W = read.widthPt;

    // ── THE OPENINGS, MEASURED FROM THE GEOMETRY ──
    const openings = openingsInWalls(
      read.segments.map((s) => ({
        ...s,
        x1: s.x1 / W,
        y1: s.y1 / W,
        x2: s.x2 / W,
        y2: s.y2 / W,
      })),
      FEET_PER_UNIT,
    );

    // ── THE MARKS PRINTED ON THE PLAN ──
    const marks: PlacedMark[] = planText.items
      .filter((i) => MARK.test(i.str.trim().toUpperCase()))
      .map((i) => ({
        text: i.str.trim(),
        x: (i.x + i.width / 2) / W,
        y: (i.y + i.height / 2) / W,
      }));

    // ── THE SCHEDULE'S MARKS, AND A SIZE WHERE ONE SITS BESIDE ONE ──
    const scheduleItems = scheduleText.items.map((i) => ({
      str: i.str.trim(),
      x: i.x,
      y: i.y,
    }));
    const rows = scheduleItems
      .filter((i) => MARK.test(i.str.toUpperCase()))
      .map((i) => {
        // The nearest size cell on the same line, to the right.
        const sizeCell = scheduleItems
          .filter((o) => Math.abs(o.y - i.y) < 6 && o.x > i.x && SIZE.test(o.str))
          .sort((a, b) => a.x - b.x)[0];
        const { widthFt, heightFt } = widthAndHeight(sizeCell?.str ?? null);
        return { mark: i.str, widthFt, heightFt, description: null };
      });

    const joined = joinOpeningsToSchedule({
      openings,
      marks,
      rows,
      feetPerUnit: FEET_PER_UNIT,
    });

    const withWidth = rows.filter((r) => r.widthFt !== null).length;
    // eslint-disable-next-line no-console
    console.log(
      `\n${SET.slice(0, 26)}  plan p${PLAN_PAGE}, schedule p${SCHEDULE_PAGE}\n` +
        `  openings drawn        ${String(openings.length).padStart(5)}\n` +
        `  marks on the plan     ${String(marks.length).padStart(5)}\n` +
        `  schedule rows         ${String(joined.rowsTotal).padStart(5)}  (${withWidth} with a readable width)\n` +
        `  MATCHED               ${String(joined.matched).padStart(5)}  ` +
        `${(joined.matchRate * 100).toFixed(0)}% of the openings\n` +
        `  rows placed on sheet  ${String(joined.rowsPlaced).padStart(5)} of ${joined.rowsTotal}\n` +
        `  width from schedule   ${String(joined.openings.filter((o) => o.widthFrom === "schedule").length).padStart(5)}\n` +
        `  width from the gap    ${String(joined.openings.filter((o) => o.widthFrom === "drawn").length).padStart(5)}\n` +
        `  MISMATCHES            ${String(joined.mismatches).padStart(5)}`,
    );

    for (const one of joined.openings.filter((o) => o.mismatch !== null).slice(0, 10)) {
      // eslint-disable-next-line no-console
      console.log(`    ${one.mark}: ${one.mismatch?.why}`);
    }
    const sample = joined.openings.filter((o) => o.widthFrom === "schedule").slice(0, 8);
    if (sample.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\n  matched, using the schedule's width:\n` +
          sample
            .map(
              (o) =>
                `    ${String(o.mark).padEnd(6)} drawn ${o.opening.widthFeet.toFixed(2)} ft` +
                `  ->  scheduled ${o.widthFt.toFixed(2)} ft`,
            )
            .join("\n"),
      );
    }

    // ── CONTROLS ──
    //
    // A run that found no openings, or no marks, would report a 0% match rate
    // and look like a measurement of the join. It is a measurement of nothing.
    expect(openings.length, "no opening was found on the plan at all").toBeGreaterThan(0);
    expect(marks.length, "no mark-shaped text was found on the plan").toBeGreaterThan(0);
    expect(joined.rowsTotal, "no row was read off the schedule page").toBeGreaterThan(0);
  });
});
