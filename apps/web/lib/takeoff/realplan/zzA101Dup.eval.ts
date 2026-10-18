import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { candidatesFromSheet, startReview } from "../answerKeyReview";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── THE DUPLICATE RULE, ON THE SHEET IT WAS WRITTEN FROM ──
 *
 * `duplicateCandidates.test.ts` proves the rule against the two A101 pairs as
 * FIXTURES — numbers typed from a report. That is the right place for the
 * boundaries and the wrong place to find out whether the rule fires on the
 * actual candidates the actual sheet produces, which is a different question
 * and the one the reviewer asked.
 *
 * So this runs the real finder over Camp Bow Wow A101, builds the real review
 * state, and prints what started rejected. Gated on a client plan set, so it
 * never runs in CI.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.A101_SET ?? "Camp Bow Wow - 100% CD_ARCH (2) (1).pdf";
const PAGE = Number(process.env.A101_PAGE ?? "8");
const FEET_PER_UNIT = Number(process.env.A101_FEET_PER_UNIT ?? "288");

describe.skipIf(DIR === "")("duplicates on the real A101", () => {
  it("pre-marks one wall offered twice", { timeout: 1_800_000 }, async () => {
    const bytes = Buffer.from(readFileSync(join(DIR, SET)));
    const read = await sheetStrokes(bytes, PAGE);
    expect(read, "the sheet could not be read").not.toBeNull();
    if (read === null) return;
    const doc = await openPlanPdf(bytes);
    const text = await doc.pageText(PAGE);

    const found = findWallsOnSheet({
      segments: read.segments,
      textItems: text.items.map((i) => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      })),
      pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
      feetPerUnit: FEET_PER_UNIT,
      wallTypes: [],
      sampledSheets: null,
    });

    const candidates = candidatesFromSheet({
      walls: found.walls,
      singles: [],
    });
    expect(candidates.length, "no candidates, so this proves nothing").toBeGreaterThan(0);

    const state = startReview(candidates, FEET_PER_UNIT);
    const byId = new Map(candidates.map((c) => [c.id, c]));

    console.log(
      `\n${candidates.length} candidates, ${state.duplicates.length} pairs where one wall is offered twice\n`,
    );
    for (const pair of state.duplicates) {
      const keep = byId.get(pair.keep);
      const drop = byId.get(pair.drop);
      console.log(
        `  keep ${keep?.lengthFeet.toFixed(1)} ft (${keep?.thicknessIn?.toFixed(1) ?? "—"} in)` +
          `  ·  drop ${drop?.lengthFeet.toFixed(1)} ft (${drop?.thicknessIn?.toFixed(1) ?? "—"} in)` +
          `  —  ${(pair.apartFeet * 12).toFixed(0)} in apart, ${(pair.share * 100).toFixed(0)}% shared`,
      );
    }

    const preRejected = Object.entries(state.verdicts).filter(([, v]) => v === "not-a-wall");
    console.log(
      `\n${preRejected.length} candidates start marked NOT A WALL, ` +
        `${preRejected.reduce((n, [id]) => n + (byId.get(id)?.lengthFeet ?? 0), 0).toFixed(1)} ft in total`,
    );
    expect(preRejected.length).toBe(state.duplicates.length);

    // The 57.7/57.0 ft pair the reviewer found by eye is the headline case.
    const west = state.duplicates.find((p) => {
      const keep = byId.get(p.keep);
      const drop = byId.get(p.drop);
      return (
        keep !== undefined &&
        drop !== undefined &&
        keep.lengthFeet > 55 &&
        keep.lengthFeet < 60 &&
        drop.lengthFeet > 55 &&
        drop.lengthFeet < 60
      );
    });
    console.log(
      west === undefined
        ? "  the 57.7/57.0 ft west pair was NOT caught"
        : "  the 57.7/57.0 ft west pair IS caught",
    );

    // And the 5.2 ft east pair must NOT be: two lines five feet apart are a
    // corridor, not one wall, and dropping one loses 65 ft of real work.
    const eastWrong = state.duplicates.some((p) => p.apartFeet > 3);
    expect(eastWrong, "something 3+ ft away was called a duplicate").toBe(false);
  });
});
