import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScheduleRowsRead } from "@prova/integrations/src/scheduleRows";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { openingsInWalls } from "../openings";
import { sheetStrokes } from "../sheetStrokes";
import { tagSymbols } from "../tagSymbols";
import { widthAndHeight } from "../openingMarks";

/**
 * ── FOR EVERY DOOR THE SCHEDULE LISTS: IS ITS MARK ON THE PLAN, IN WHAT, AND
 *    IS THERE AN OPENING NEAR IT? ──
 *
 * `zzDoorJoin2` reports 11 of 30 rows placed. This says, row by row, which of
 * the three things failed for the other 19 — no mark on the sheet, a mark the
 * symbol detector did not see, or a mark with no detected opening near it —
 * because each needs a different fix.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const CACHE = process.env.DOOR_CACHE ?? "";
const SET = process.env.DOOR_SET ?? "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf";
const PLAN_PAGE = Number(process.env.DOOR_PLAN ?? "8");
const SCHEDULE_PAGE = Number(process.env.DOOR_SCHEDULE ?? "26");
const FEET_PER_UNIT = Number(process.env.DOOR_FPU ?? "288.4866205070642");

describe.skipIf(DIR === "" || CACHE === "")("door report", () => {
  it("prints each schedule row's fate on the plan", { timeout: 1_800_000 }, async () => {
    const cacheAt = join(CACHE, `${SET.replace(/\W+/g, "_")}-p${SCHEDULE_PAGE}-schedule.json`);
    expect(existsSync(cacheAt)).toBe(true);
    const read = JSON.parse(readFileSync(cacheAt, "utf8")) as ScheduleRowsRead;
    const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, SET))));
    const planRead = await sheetStrokes(Buffer.from(readFileSync(join(DIR, SET))), PLAN_PAGE);
    const W = planRead.widthPt;
    const items = (await doc.pageText(PLAN_PAGE)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
    const openings = openingsInWalls(
      planRead.segments.map((s) => ({ ...s, x1: s.x1 / W, y1: s.y1 / W, x2: s.x2 / W, y2: s.y2 / W })),
      FEET_PER_UNIT,
    );
    const symbols = tagSymbols({ segments: planRead.segments, text: items, unitsPerPaperInch: 72 });
    console.log(`schedule p${SCHEDULE_PAGE}: ${read.rows.length} rows (${read.kind}); plan p${PLAN_PAGE}: ${openings.length} openings, ${symbols.length} symbols`);
    console.log("  mark   size        text hits  symbol hits (shape/r/rej)                     nearest opening to a hit (ft)");
    const nearestOpening = (x: number, y: number) => {
      let best = Infinity;
      for (const o of openings) {
        const d = Math.hypot((o.x1 + o.x2) / 2 - x, (o.y1 + o.y2) / 2 - y) * FEET_PER_UNIT;
        if (d < best) best = d;
      }
      return best;
    };
    let placed = 0;
    for (const row of read.rows) {
      const key = row.mark.trim().toUpperCase();
      const textHits = items.filter((i) => i.str.trim().toUpperCase() === key);
      const symHits = symbols.filter((s) => s.text.trim().toUpperCase().split(/\s+/).includes(key));
      const dists = symHits.map((s) => nearestOpening(s.x / W, s.y / W));
      const textDists = textHits.map((i) => nearestOpening((i.x + i.width / 2) / W, (i.y + i.height / 2) / W));
      const near = Math.min(...dists, Infinity);
      if (near <= 6) placed += 1;
      const { widthFt } = widthAndHeight(row.size);
      console.log(
        `  ${key.padEnd(6)} ${(row.size ?? "-").padEnd(11).slice(0, 11)} ${String(textHits.length).padStart(4)}       ` +
          `${symHits.map((s) => `${s.shape}/${(s.radius / 72).toFixed(2)}/${s.rejected ?? "ok"}`).join(" ").padEnd(44).slice(0, 44)}  ` +
          `${dists.map((d) => d.toFixed(1)).join(" ") || "-"}   text: ${textDists.map((d) => d.toFixed(1)).join(" ") || "-"}` +
          (widthFt === null ? "  (no width)" : ""),
      );
    }
    console.log(`\n  rows with a symbol hit within 6 ft of an opening: ${placed} of ${read.rows.length}`);
    expect(read.rows.length).toBeGreaterThan(0);
  });
});
