import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";

/**
 * ── CAN A DOOR MARK ON THE PLAN BE TOLD FROM A ROOM NUMBER? ──
 *
 * Joining a door schedule to the plan needs the MARK to be findable on both
 * sides. The schedule's side is already structured — `scheduleRows.ts` reads a
 * table into `{mark, description, size, …}`. The plan's side is loose text,
 * and that is where the join either works or does not.
 *
 * This counts, per page, every text item shaped like a mark, so the two sides
 * can be compared before anything is built to join them. It exists because the
 * same question asked of WALL-TYPE tags on this set answered badly: Camp Bow
 * Wow's partition marks are bare `A` and `B`, indistinguishable from detail
 * bubbles, and `wallTypeTags` correctly reads zero on A101.
 *
 *     REAL_PLAN_DIR=… DM_SHEETS="<file>:8,26" npx vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan/zzDoorMarks.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SHEETS = (process.env.DM_SHEETS ?? "").trim();

/** `101`, `101A`, `D-12`, `W3` — what a door or window mark looks like. */
const MARK = /^(?:[A-Z]{1,3}[-\s]?)?\d{1,4}[A-Z]?$/;

describe.skipIf(DIR === "" || SHEETS === "")("marks on a sheet", () => {
  it("counts the text that could be a door or window mark", { timeout: 1_800_000 }, async () => {
    const pagesSeen: number[] = [];
    for (const token of SHEETS.split(";").filter((t) => t.includes(":"))) {
      const at = token.lastIndexOf(":");
      const file = token.slice(0, at);
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, file))));
      for (const page of token
        .slice(at + 1)
        .split(",")
        .map(Number)) {
        const text = await doc.pageText(page);
        pagesSeen.push(page);
        const marks = text.items
          .map((i) => i.str.trim().toUpperCase())
          .filter((s) => MARK.test(s));
        const counts = new Map<string, number>();
        for (const m of marks) counts.set(m, (counts.get(m) ?? 0) + 1);
        const sorted = [...counts].sort((a, b) => b[1] - a[1]);
        // eslint-disable-next-line no-console
        console.log(
          `\n${file.slice(0, 26)} p${page} — ${text.items.length} items, ` +
            `${marks.length} mark-shaped, ${counts.size} distinct\n` +
            `  commonest: ${sorted
              .slice(0, 14)
              .map(([m, n]) => `${m}×${n}`)
              .join("  ")}\n` +
            `  once only: ${sorted
              .filter(([, n]) => n === 1)
              .slice(0, 24)
              .map(([m]) => m)
              .join(" ")}`,
        );
      }
    }
    // The input resolved: a DM_SHEETS naming no real file would otherwise
    // print nothing and pass as a quiet success.
    expect(
      pagesSeen.length,
      "no page was read at all — check REAL_PLAN_DIR and DM_SHEETS",
    ).toBeGreaterThan(0);
  });
});
