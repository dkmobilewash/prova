import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractScheduleRows,
  type ScheduleRowsRead,
} from "@prova/integrations/src/scheduleRows";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { gridText, tableRowsFromPage } from "../../plan-ingest/scheduleTable";
import { joinOpeningsToSchedule, widthAndHeight, type PlacedMark } from "../openingMarks";
import { openingsInWalls } from "../openings";
import { sheetStrokes } from "../sheetStrokes";
import { tagSymbols } from "../tagSymbols";

/**
 * ── THE REAL SCHEDULE READ, AND DOOR MARKS FOUND BY THEIR SYMBOLS ──
 *
 * `zzOpeningJoin.eval.ts` measured 13% with two deliberate shortcuts: the
 * schedule's rows came from a crude text pass rather than `scheduleRows.ts`,
 * and the plan's marks were any text shaped like a mark. Both are replaced
 * here — the model reads the table, and a mark counts only when it is drawn
 * inside a symbol, which is what separates a door's mark from the room number
 * printed in the middle of the room.
 *
 *     REAL_PLAN_DIR=… DOOR_CACHE=… npx vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan/zzDoorJoin2.eval.ts
 *
 * The schedule read is cached per file, page and prompt version, so re-running
 * costs nothing.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const CACHE = process.env.DOOR_CACHE ?? "";
const SET = process.env.DOOR_SET ?? "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf";
const PLAN_PAGE = Number(process.env.DOOR_PLAN ?? "8");
const SCHEDULE_PAGE = Number(process.env.DOOR_SCHEDULE ?? "26");
const FEET_PER_UNIT = Number(process.env.DOOR_FPU ?? "288.4866205070642");
const LIVE = process.env.DOOR_LIVE !== "0";

describe.skipIf(DIR === "" || CACHE === "")("joining a read door schedule to a plan", () => {
  it("uses the real schedule read and symbol marks", { timeout: 3_600_000 }, async () => {
    const bytes = () => Buffer.from(readFileSync(join(DIR, SET)));
    const doc = await openPlanPdf(bytes());

    // ── 1. THE SCHEDULE, READ BY THE MODEL ──
    const cacheAt = join(CACHE, `${SET.replace(/\W+/g, "_")}-p${SCHEDULE_PAGE}-schedule.json`);
    let read: ScheduleRowsRead | null = null;
    if (existsSync(cacheAt)) {
      read = JSON.parse(readFileSync(cacheAt, "utf8")) as ScheduleRowsRead;
      // eslint-disable-next-line no-console
      console.log(`\n1. cached schedule read: ${cacheAt}`);
    } else if (LIVE) {
      const text = await doc.pageText(SCHEDULE_PAGE);
      // `tableRowsFromPage` takes the whole page, not a list of items.
      const rows = tableRowsFromPage(text);
      let spent = { input: 0, output: 0 };
      read = await extractScheduleRows({
        grid: gridText(rows),
        pageNumber: SCHEDULE_PAGE,
        sheetTitle: "DOOR SCHEDULE",
        onUsage: (usage) => {
          spent = { input: usage.inputTokens, output: usage.outputTokens };
        },
      });
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(cacheAt, JSON.stringify(read, null, 1), "utf8");
      const cost = (spent.input / 1e6) * 5 + (spent.output / 1e6) * 25;
      // eslint-disable-next-line no-console
      console.log(
        `\n1. LIVE schedule read p${SCHEDULE_PAGE}: ${spent.input} in, ${spent.output} out, ` +
          `about $${cost.toFixed(3)}`,
      );
    }
    if (read === null) {
      // eslint-disable-next-line no-console
      console.log("\n   nothing cached and DOOR_LIVE=0");
      return;
    }
    // eslint-disable-next-line no-console
    console.log(
      `   kind ${read.kind}, ${read.rows.length} rows, confidence ${read.confidence}\n   ${read.reason.slice(0, 160)}`,
    );
    expect(read.rows.length, "the schedule read returned no rows").toBeGreaterThan(0);

    // ── 2. THE PLAN: OPENINGS, AND MARKS THAT ARE DRAWN IN A SYMBOL ──
    const planRead = await sheetStrokes(bytes(), PLAN_PAGE);
    expect(planRead, "the plan could not be read").not.toBeNull();
    if (planRead === null) return;
    const W = planRead.widthPt;
    const planText = await doc.pageText(PLAN_PAGE);
    const items = planText.items.map((i) => ({
      str: i.str,
      x: i.x,
      y: i.y,
      width: i.width,
      height: i.height,
    }));

    const openings = openingsInWalls(
      planRead.segments.map((s) => ({
        ...s,
        x1: s.x1 / W,
        y1: s.y1 / W,
        x2: s.x2 / W,
        y2: s.y2 / W,
      })),
      FEET_PER_UNIT,
    );

    const symbols = tagSymbols({ segments: planRead.segments, text: items, unitsPerPaperInch: 72 });
    const symbolMarks: PlacedMark[] = symbols
      .filter((s) => s.rejected === null)
      .map((s) => ({ text: s.text, x: s.x / W, y: s.y / W }));
    /** Every mark-shaped string, symbol or not — the old way, for comparison. */
    const looseMarks: PlacedMark[] = items
      .filter((i) => /^(?:[A-Z]{1,3}[-\s]?)?\d{1,4}[A-Z]?$/.test(i.str.trim().toUpperCase()))
      .map((i) => ({ text: i.str.trim(), x: (i.x + i.width / 2) / W, y: (i.y + i.height / 2) / W }));

    const rows = read.rows.map((row) => {
      const { widthFt, heightFt } = widthAndHeight(row.size);
      return { mark: row.mark, widthFt, heightFt, description: row.description };
    });

    const bySymbol = joinOpeningsToSchedule({
      openings,
      marks: symbolMarks,
      rows,
      feetPerUnit: FEET_PER_UNIT,
    });
    const byText = joinOpeningsToSchedule({
      openings,
      marks: looseMarks,
      rows,
      feetPerUnit: FEET_PER_UNIT,
    });

    // eslint-disable-next-line no-console
    console.log(
      `\n2. plan p${PLAN_PAGE}: ${openings.length} openings, ` +
        `${symbols.length} symbols of which ${symbolMarks.length} could be marks, ` +
        `${looseMarks.length} mark-shaped strings anywhere\n` +
        `\n   ${"".padEnd(22)}  matched   rate   rows placed   width from schedule   mismatches\n` +
        `   marks in a SYMBOL     ${String(bySymbol.matched).padStart(7)}  ` +
        `${(bySymbol.matchRate * 100).toFixed(0).padStart(4)}%  ` +
        `${String(bySymbol.rowsPlaced).padStart(11)}   ` +
        `${String(bySymbol.openings.filter((o) => o.widthFrom === "schedule").length).padStart(19)}   ` +
        `${String(bySymbol.mismatches).padStart(10)}\n` +
        `   any mark-shaped text  ${String(byText.matched).padStart(7)}  ` +
        `${(byText.matchRate * 100).toFixed(0).padStart(4)}%  ` +
        `${String(byText.rowsPlaced).padStart(11)}   ` +
        `${String(byText.openings.filter((o) => o.widthFrom === "schedule").length).padStart(19)}   ` +
        `${String(byText.mismatches).padStart(10)}`,
    );

    for (const one of bySymbol.openings.filter((o) => o.mismatch !== null).slice(0, 8)) {
      // eslint-disable-next-line no-console
      console.log(`     ${one.mark}: ${one.mismatch?.why.slice(0, 120)}`);
    }
    const sample = bySymbol.openings.filter((o) => o.widthFrom === "schedule").slice(0, 8);
    if (sample.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\n   matched, using the schedule's width:\n` +
          sample
            .map(
              (o) =>
                `     ${String(o.mark).padEnd(6)} drawn ${o.opening.widthFeet.toFixed(2)} ft` +
                `  ->  scheduled ${o.widthFt.toFixed(2)} ft`,
            )
            .join("\n"),
      );
    }

    expect(openings.length, "no opening was found at all").toBeGreaterThan(0);
    expect(symbols.length, "no symbol was found at all").toBeGreaterThan(0);
  });
});
