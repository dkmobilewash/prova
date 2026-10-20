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
import { bareTextTags } from "../bareTextTags";
import { openingsInWalls } from "../openings";
import { sheetStrokes } from "../sheetStrokes";
import { shapeFromLegend, tagSymbols } from "../tagSymbols";
import { findWallsOnSheet } from "../findWallsOnSheet";

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
    // ── THE DOOR MARK'S SHAPE IS REPORTED, NOT USED TO FILTER ──
    //
    // A door schedule is a table and draws no symbol beside its marks, so the
    // shape cannot come from it, and the plan prints every mark TWICE — in a
    // pill at the door and in a box under the room name — so "the shape most
    // marks are drawn in" flips between the two with the count. Measured:
    // filtering on the learned shape placed 29 rows on one run and 24 on the
    // next, for the same drawing. What separates the door's printing from the
    // room's is where it sits, and the join already decides that — nearest a
    // detected gap, else nearest a wall — so every symbol holding a scheduled
    // mark is offered and geometry picks.
    const scheduleMarks = read.rows.map((r) => r.mark);
    const markShape = shapeFromLegend(symbols, { codes: scheduleMarks });
    const scheduleSet = new Set(scheduleMarks.map((m) => m.toUpperCase()));
    const symbolMarks: PlacedMark[] = symbols
      // Bunkie's `E105A` reads as a sheet reference; the schedule says it is a door.
      .filter((s) => s.rejected === null || (s.rejected === "sheet-reference" && scheduleSet.has(s.text.trim().toUpperCase())))
      .map((s) => ({ text: s.text, x: s.x / W, y: s.y / W }));
    const walls = findWallsOnSheet({
      segments: planRead.segments,
      textItems: items,
      pageSize: { widthPt: W, heightPt: planRead.heightPt },
      feetPerUnit: FEET_PER_UNIT,
      wallTypes: [],
      sampledSheets: null,
    }).walls;
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
      walls,
    });
    const byText = joinOpeningsToSchedule({
      openings,
      marks: looseMarks,
      rows,
      feetPerUnit: FEET_PER_UNIT,
      walls,
    });
    // ── BARE TEXT THAT IS EXACTLY A SCHEDULED MARK, BESIDE A WALL ──
    //
    // MHK and Bunkie print their marks with no symbol. The schedule is the
    // vocabulary and the wall is the place; everything else on the sheet
    // that looks like a mark is not offered.
    const bare = bareTextTags({
      text: items,
      vocabulary: new Set(scheduleMarks.map((m) => m.toUpperCase())),
      symbols,
      walls,
      feetPerUnit: FEET_PER_UNIT,
      widthPt: W,
    });
    const markSet = new Set(scheduleMarks.map((m) => m.toUpperCase()));
    const placedMarks = new Set(bySymbol.openings.map((o) => o.mark?.toUpperCase()).filter((m): m is string => m !== undefined));
    const symbolHolding = symbols
      .filter((sy) => markSet.has(sy.text.trim().toUpperCase()))
      .map((sy) => {
        const px = sy.x / W, py = sy.y / W;
        let d = Infinity;
        for (const w of walls) {
          const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len2 = dx * dx + dy * dy;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / len2));
          d = Math.min(d, Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy)) * FEET_PER_UNIT);
        }
        return `${sy.text} ${sy.shape} ${sy.rejected ?? "ok"} ${d === Infinity ? "no wall" : d.toFixed(1) + " ft"}${placedMarks.has(sy.text.trim().toUpperCase()) ? " PLACED" : ""}`;
      });
    console.log(`   symbols holding a scheduled mark: ${symbolHolding.join(", ")}`);
    const bareMisses = items
      .filter((i) => markSet.has(i.str.trim().toUpperCase()) && !bare.some((b) => b.x === (i.x + i.width / 2) / W))
      .map((i) => {
        const px = (i.x + i.width / 2) / W;
        const py = (i.y - i.height / 2) / W;
        let d = Infinity;
        for (const w of walls) {
          const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len2 = dx * dx + dy * dy;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / len2));
          d = Math.min(d, Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy)) * FEET_PER_UNIT);
        }
        const cx = i.x + i.width / 2, cy = i.y - i.height / 2;
        const inside = symbols.find((sy) => Math.hypot(sy.x - cx, sy.y - cy) <= sy.radius);
        return `${i.str.trim()} ${d === Infinity ? "no wall" : d.toFixed(1) + " ft"}${inside ? ` [in ${inside.shape} r${(inside.radius / 72).toFixed(2)}in "${inside.text}" ${inside.rejected ?? "ok"}]` : ""}`;
      });
    // ── DOUBTFUL: A SCHEDULED MARK INSIDE A ROOM-NAME BOX ──
    //
    // MHK's door 105 is printed nowhere but as the `105` of `OFFICE 105`, and
    // the schedule's mark IS the room number. Offered as a separate tier and
    // cropped, because the box is beside the room, not the door.
    const roomBoxMarks: PlacedMark[] = items
      .filter((i) => markSet.has(i.str.trim().toUpperCase()))
      .filter((i) => {
        const cx = i.x + i.width / 2, cy = i.y - i.height / 2;
        const inside = symbols.find((sy) => Math.hypot(sy.x - cx, sy.y - cy) <= sy.radius);
        return inside !== undefined && inside.rejected === "code-too-long";
      })
      .map((i) => ({ text: i.str.trim(), x: (i.x + i.width / 2) / W, y: (i.y - i.height / 2) / W }));
    const byRoomBox = joinOpeningsToSchedule({
      openings,
      marks: [...symbolMarks, ...bare.map((b) => ({ text: b.text, x: b.x, y: b.y })), ...roomBoxMarks],
      rows,
      feetPerUnit: FEET_PER_UNIT,
      walls,
    });
    if (process.env.CROP_JSON) {
      const crops = byRoomBox.openings
        .filter((o) => o.mark !== null && roomBoxMarks.some((m) => m.text === o.mark) && !bare.some((b) => b.text === o.mark) && !symbolMarks.some((m) => m.text === o.mark))
        .map((o) => {
          const m = roomBoxMarks.find((r) => r.text === o.mark)!;
          return { code: o.mark, shape: "room-box", sx: m.x * W, sy: m.y * W, lx: null, ly: null, wall: { x1: o.opening.x1 * W, y1: o.opening.y1 * W, x2: o.opening.x2 * W, y2: o.opening.y2 * W }, distFt: 0 };
        });
      writeFileSync(process.env.CROP_JSON, JSON.stringify({ set: SET, page: PLAN_PAGE, widthPt: W, heightPt: planRead.heightPt, feetPerUnit: FEET_PER_UNIT, crops }, null, 1));
    }
    const byBare = joinOpeningsToSchedule({
      openings,
      marks: [...symbolMarks, ...bare.map((b) => ({ text: b.text, x: b.x, y: b.y }))],
      rows,
      feetPerUnit: FEET_PER_UNIT,
      walls,
    });

    // eslint-disable-next-line no-console
    console.log(
      `\n2. plan p${PLAN_PAGE}: ${openings.length} openings, ` +
        `${symbols.length} symbols of which ${symbolMarks.length} could be marks, ` +
        `${looseMarks.length} mark-shaped strings anywhere; commonest shape holding a scheduled mark: ${markShape ?? "none"} (reported, not filtered on)\n` +
        `\n   ${"".padEnd(22)}  matched   rate   rows placed   width from schedule   mismatches   placed by mark\n` +
        `   marks in a SYMBOL     ${String(bySymbol.matched).padStart(7)}  ` +
        `${(bySymbol.matchRate * 100).toFixed(0).padStart(4)}%  ` +
        `${String(bySymbol.rowsPlaced).padStart(11)}   ` +
        `${String(bySymbol.openings.filter((o) => o.widthFrom === "schedule").length).padStart(19)}   ` +
        `${String(bySymbol.mismatches).padStart(10)}   ${String(bySymbol.placedByMark).padStart(14)}\n` +
        `   any mark-shaped text  ${String(byText.matched).padStart(7)}  ` +
        `${(byText.matchRate * 100).toFixed(0).padStart(4)}%  ` +
        `${String(byText.rowsPlaced).padStart(11)}   ` +
        `${String(byText.openings.filter((o) => o.widthFrom === "schedule").length).padStart(19)}   ` +
        `${String(byText.mismatches).padStart(10)}   ${String(byText.placedByMark).padStart(14)}\n` +
        `   symbols + exact bare marks ${String(byBare.matched).padStart(3)}  ` +
          `${String(Math.round(byBare.matchRate * 100)).padStart(4)}%  ${String(byBare.rowsPlaced).padStart(11)}  ` +
          `${String(byBare.openings.filter((o) => o.widthFrom === "schedule").length).padStart(20)}  ${String(byBare.mismatches).padStart(11)}  ${String(byBare.placedByMark).padStart(15)}   [${bare.map((b) => b.text).join(" ")}]\n` +
        `   + room-box marks (doubtful) ${String(byRoomBox.matched).padStart(3)}  ${String(Math.round(byRoomBox.matchRate * 100)).padStart(4)}%  ${String(byRoomBox.rowsPlaced).padStart(11)}  ` +
          `${String(byRoomBox.openings.filter((o) => o.widthFrom === "schedule").length).padStart(20)}  ${String(byRoomBox.mismatches).padStart(11)}  ${String(byRoomBox.placedByMark).padStart(15)}   [${roomBoxMarks.map((m) => m.text).join(" ")}]\n` +
        `   exact schedule marks NOT beside a wall (in a symbol, or too far): ${bareMisses.join(", ")}`,
    );

    for (const one of bySymbol.openings.filter((o) => o.mismatch !== null).slice(0, 8)) {
      // eslint-disable-next-line no-console
      console.log(`     ${one.mark}: ${one.mismatch?.why.slice(0, 120)}`);
    }
    const sample = bySymbol.openings.filter((o) => o.widthFrom === "schedule" && o.placedBy === "opening").slice(0, 8);
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

    const byMarkOnly = bySymbol.openings.filter((o) => o.placedBy === "mark");
    if (byMarkOnly.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\n   placed by their mark on the nearest run, no gap detected there: ` +
          byMarkOnly.map((o) => o.mark).join(" "),
      );
    }
    const unplaced = rows.filter((r) => !bySymbol.openings.some((o) => o.matched?.mark === r.mark));
    // eslint-disable-next-line no-console
    console.log(`   rows still unplaced: ${unplaced.map((r) => r.mark).join(" ") || "none"}`);

    expect(openings.length, "no opening was found at all").toBeGreaterThan(0);
    expect(symbols.length, "no symbol was found at all").toBeGreaterThan(0);
  });
});
