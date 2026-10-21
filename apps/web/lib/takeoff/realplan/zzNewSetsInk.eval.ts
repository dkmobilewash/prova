import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sheetStrokes } from "../sheetStrokes";
import { heldOutReason } from "../heldOutSets";

/**
 * ── IS THERE ACTUALLY INK ON THE SHEET A LINK POINTS AT? ──
 *
 * `sheets-for-set.mjs` proves a scale could be READ from the drawing, which
 * is strong evidence and not the same claim: a page can print "1/8\" = 1'-0\""
 * in its title block and carry a scanned raster, or an almost empty sheet of
 * general notes. A labelling link handed to a reviewer should be one where the
 * finder has geometry to work with.
 *
 * So this reads each page with the SAME reader the app uses and reports the
 * stroke count. It asserts a floor rather than a target, because the number
 * that matters is "enough to be a drawing" and anything tighter would be a
 * figure tuned to today's eight sheets.
 *
 * Held-out sets are READ here on purpose and that is safe: this counts strokes
 * and never looks at a label, a verdict or a key. `heldOutReason` is printed
 * beside each one so the output says which sheets must never reach training.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";

/** Enough vector geometry that a floor plan is plainly present. */
const INK_FLOOR = 2000;

const SHEETS = [
  { file: "new/Topeka-Senior-Villas.pdf", page: 74, as: "TRAINING" },
  { file: "new/Camp-Clark-60-Soldier-Barracks.pdf", page: 14, as: "TRAINING" },
  { file: "new/Missouri-State-Fairgrounds-New-Comfort-Station.pdf", page: 16, as: "TRAINING" },
  { file: "new/Supreme-Court-of-Missouri-Judiciary-Library.pdf", page: 6, as: "TRAINING" },
  { file: "new/Joplin-community-center.pdf", page: 46, as: "TRAINING" },
  { file: "new/KSU-Fairchild-Hall.pdf", page: 22, as: "HELD OUT" },
  { file: "new/Albany-Readiness-Center.pdf", page: 11, as: "HELD OUT" },
  { file: "new/OReillys-Architectural-Drawings.pdf", page: 1, as: "HELD OUT" },
];

describe.skipIf(DIR === "")("the new labelling links have ink behind them", () => {
  it("reads every one with the app's own reader", { timeout: 3_600_000 }, async () => {
    const rows: string[] = [];
    const thin: string[] = [];

    for (const sheet of SHEETS) {
      const bytes = Buffer.from(readFileSync(join(DIR, sheet.file)));
      const read = await sheetStrokes(bytes, sheet.page);
      const held = heldOutReason(sheet.file);
      const n = read === null ? 0 : read.segments.length;
      const size =
        read === null ? "unreadable" : `${Math.round(read.widthPt)}x${Math.round(read.heightPt)}pt`;
      rows.push(
        `  ${sheet.file.replace("new/", "").slice(0, 42).padEnd(44)} p${String(sheet.page).padStart(3)} · ` +
          `${String(n).padStart(6)} strokes · ${size.padEnd(13)} · ${sheet.as}` +
          `${held === null ? "" : " · refused by heldOutSets"}`,
      );
      if (n < INK_FLOOR) thin.push(`${sheet.file} p${sheet.page}: ${n} strokes`);
      // A set marked HELD OUT here and not refused by the training path is the
      // one failure that matters: the link would be handed out as a test key
      // while a training run would happily eat its labels.
      if (sheet.as === "HELD OUT") {
        expect(held, `${sheet.file} is held out but heldOutSets allows it`).not.toBeNull();
      } else {
        expect(held, `${sheet.file} is training but heldOutSets refuses it`).toBeNull();
      }
    }

    console.log(`\n${SHEETS.length} sheets behind the new labelling links\n`);
    for (const row of rows) console.log(row);
    console.log(`\n  ink floor ${INK_FLOOR} strokes — thin sheets: ${thin.length === 0 ? "none" : thin.join("; ")}`);

    // A FLOOR on what resolved, which is the harness's own requirement and the
    // right one: a mistyped folder reads every file as missing, and without
    // this the run would print an empty table and pass.
    expect(rows.length, "no sheet was read, so every figure would be absent").toBeGreaterThan(7);
    expect(rows).toHaveLength(SHEETS.length);
    expect(thin, "a link was going to be handed out for a sheet with almost no geometry").toEqual([]);
  });
});
