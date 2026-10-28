import { Buffer } from "node:buffer";
/**
 * ONE PIPELINE: the server measured a sheet differently from the viewer.
 *
 * `detectWallsForCalibration` — the calibration save, and the whole-set
 * takeoff built on it — called `findWallsOnSheet` on the WHOLE SHEET. The
 * viewer has not done that since view detection landed: it calls
 * `detectForSheet`, which splits the sheet into drawings, keeps the plan views
 * and measures each at its own scale.
 *
 * So the server measured ELEVATIONS as walls, and everything downstream
 * inherited it.
 *
 * This prints both measures for the sheets the change was argued over, so the
 * claim is a number rather than a description. WHOLE is what the server did;
 * SHARED is what every path does now.
 *
 *     REAL_PLAN_DIR="…/real-plans" npx vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan/zzOnePipeline.eval.ts
 *
 * Local only: it reads the plans folder and writes nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { detectForSheet } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";

const DIR = process.env.REAL_PLAN_DIR ?? "";

/** The sheets this change was argued over. A401 is the elevation sheet. */
// PAGE NUMBERS COME FROM THE LABEL FILES, NOT FROM GUESSING. The first run of
// this eval used guessed pages and measured entirely different sheets — three
// of them returned zero walls, which read as "the change broke plan sheets"
// when it was "these are not plan sheets". The labels record the page each
// sheet was judged on; that is the only source for it.
//
// Baker has NO A401. Its sheets are A100, A101, A121, A201, A301, A351 and the
// A5xx details; the ELEVATIONS are A201 at page 16, which is what is measured
// here in its place.
const SHEETS = [
  { label: "Murray A101", file: "new/IFBREBID-Murray-Tower-Package.pdf", page: 24 },
  { label: "Crosslines A100", file: "new/Crosslines-Phase-II-Drawings.pdf", page: 10 },
  { label: "Baker A100", file: "new/2025.07.08_Baker_EOC_BID.pdf", page: 12 },
  { label: "Baker A101", file: "new/2025.07.08_Baker_EOC_BID.pdf", page: 13 },
  { label: "Baker A201 (elevations)", file: "new/2025.07.08_Baker_EOC_BID.pdf", page: 16 },
];

// `skipIf` rather than `runIf` — the same condition, and the form
// `harness.test.ts` looks for when it re-proves that a keyless eval cannot
// pass by having no input.
describe.skipIf(!DIR)("one pipeline everywhere", () => {
  const rows: { label: string; whole: string; shared: string }[] = [];

  for (const sheet of SHEETS) {
    const path = join(DIR, sheet.file);
    it.runIf(existsSync(path))(`${sheet.label}: the shared pipeline is what every path gets`, async () => {
      // The idiom every eval in this folder uses: bytes once, strokes from the
      // bytes, text from the opened document.
      const bytes = Buffer.from(readFileSync(path));
      const strokes = await sheetStrokes(bytes, sheet.page);
      const doc = await openPlanPdf(bytes);
      {
        const text = await doc.pageText(sheet.page);
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const pageSize = { widthPt: strokes.widthPt, heightPt: strokes.heightPt };
        // Any fixed scale will do: both arms get the SAME one, and the claim is
        // about which strokes are measured, not what they measure to.
        const feetPerUnit = 100;

        const whole = findWallsOnSheet({ segments: strokes.segments, textItems, pageSize, feetPerUnit, wallTypes: [], sampledSheets: null });
        const shared = detectForSheet({ segments: strokes.segments, textItems, pageSize, feetPerUnit });

        const ft = (f: { walls: readonly { lengthFeet: number }[] }) =>
          f.walls.reduce((n, w) => n + w.lengthFeet, 0);

        rows.push({
          label: sheet.label,
          whole: `${whole.walls.length} walls / ${Math.round(ft(whole))} ft`,
          shared: `${shared.found.walls.length} walls / ${Math.round(ft(shared.found))} ft`,
        });

        // ── THE INPUT IS NON-ZERO, SO A MISSING SHEET CANNOT READ AS A CLEAN RUN ──
        //
        // This asserted `walls.length >= 0`, which is true of every array ever
        // made. A mistyped page or a scanned sheet would have produced 0 and 0
        // in both columns and printed a tidy table saying the paths agree —
        // the vacuous pass this whole folder's guards exist to refuse.
        //
        // The page having STROKES is the thing that cannot be faked by an
        // absent file, and the counts above are only worth reading because of
        // it.
        expect(strokes.segments.length, `${sheet.label}: no strokes on this page — wrong page, or a scanned sheet`).toBeGreaterThan(200);
      }
    });
  }

  it("prints both measures side by side", () => {
    if (rows.length === 0) return;
    const w = Math.max(...rows.map((r) => r.label.length));
    console.log(`\n  ${"sheet".padEnd(w)}  ${"WHOLE (the server's old measure)".padEnd(34)}SHARED (every path now)`);
    for (const r of rows) console.log(`  ${r.label.padEnd(w)}  ${r.whole.padEnd(34)}${r.shared}`);
    console.log("");
  });
});
