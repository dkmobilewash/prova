import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFSET_INCHES, offsetCandidates, type Run } from "../offsetCandidates";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── WHICH ACCEPTED RUNS ARE NOT ON THE WALL ──
 *
 * Diego named six on A4.B.3 by their panel position — #168, #247, #254, #286
 * and the short C2 closet side walls — and asked for the same pattern to be
 * LISTED on A4.B.1 and A4.B.2 before anything is changed.
 *
 * ── THE NUMBERING IS ITSELF A FINDING, WHICH IS WHY THIS PRINTS POSITIONS ──
 *
 * Nothing in the app shows a candidate number: the panel row shows a length, a
 * thickness and a note, and the plan overlay draws no label. So "#247" is the
 * labeller counting rows, and a position is only meaningful against the same
 * list in the same order. This prints each flagged run's position in the saved
 * `verdicts` array, 1-based, so the two can be compared rather than assumed —
 * if the geometry independently flags runs at the positions Diego named, both
 * the detector and the numbering are confirmed at once. Changing a label on a
 * guessed position would be editing somebody's work on a hunch.
 *
 *     REAL_PLAN_DIR=… LABEL_DIR=… npx vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan/zzOffset.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const SET = "2025-03-28_ELEVEN03 PERMIT SET_ARCH.pdf";
const LABEL_SET = "2025-03-28_ELEVEN03_PERMIT_SET_ARCH.pdf";
const SHEETS: ReadonlyArray<readonly [string, number]> = [
  ["A4.B.1", 119],
  ["A4.B.2", 120],
  ["A4.B.3", 121],
];
/** What Diego named on A4.B.3, to test the numbering against. */
const NAMED = [168, 247, 254, 286];

type Saved = {
  feetPerUnit: number;
  verdicts: (Run & { verdict: string })[];
};

describe.skipIf(DIR === "" || LABELS === "")("accepted runs that sit off the wall", () => {
  it("lists them per sheet, with their position in the saved file", { timeout: 3_600_000 }, async () => {
    let flaggedAnywhere = 0;
    /** Every sheet whose geometry was actually read, so a wrong path fails. */
    const sheetsRead: string[] = [];
    for (const [sheet, page] of SHEETS) {
      const saved = JSON.parse(
        readFileSync(join(LABELS, LABEL_SET, `${sheet}.json`), "utf8"),
      ) as Saved;
      const read = await sheetStrokes(Buffer.from(readFileSync(join(DIR, SET))), page);
      expect(read, `${sheet}: the sheet could not be read`).not.toBeNull();
      if (read === null) continue;

      sheetsRead.push(sheet);
      // Position in the SAVED ORDER, 1-based, which is what a labeller
      // counting rows would have arrived at.
      const accepted = saved.verdicts
        .map((v, i) => ({ ...v, at: i + 1 }))
        .filter((v) => v.verdict === "wall");

      // Points -> page-width units, which is what the saved runs are in.
      const W = read.widthPt;
      const findings = offsetCandidates({
        runs: accepted,
        segments: read.segments.map((s) => ({
          ...s,
          x1: s.x1 / W,
          y1: s.y1 / W,
          x2: s.x2 / W,
          y2: s.y2 / W,
        })),
        feetPerUnit: saved.feetPerUnit,
      });

      // ── THE SECOND CONTROL: were any faces seen at all? ──
      //
      // Zero findings is the answer whether the sheet is clean or the
      // coordinates are in the wrong system, and the first run of this eval
      // was the latter on all three sheets. So count the runs that HAVE a
      // full-length face pair near them, which is a number only a working
      // search can produce.
      const withPair = offsetCandidates({
        runs: accepted,
        segments: read.segments.map((s) => ({
          ...s,
          x1: s.x1 / W,
          y1: s.y1 / W,
          x2: s.x2 / W,
          y2: s.y2 / W,
        })),
        feetPerUnit: saved.feetPerUnit,
        minInches: 0,
      }).length;
      expect(
        withPair,
        `${sheet}: no accepted run has a face pair near it — the search found nothing, ` +
          `which is not the same as the sheet being clean`,
      ).toBeGreaterThan(0);

      // ── THE CONTROL: a detector that flags everything says nothing ──
      //
      // If most accepted runs came back flagged, the threshold or the face
      // test would be wrong rather than the labels. The share is printed so
      // that is visible instead of inferred.
      const share = accepted.length === 0 ? 0 : (findings.length / accepted.length) * 100;
      const lines = [
        `\n${sheet} (p${page}) — ${accepted.length} accepted, ${withPair} with a face pair, ` +
          `${findings.length} flagged over ${OFFSET_INCHES}in (${share.toFixed(0)}%)`,
        `   pos    length   run thk   pair thk   offset   faces`,
      ];
      for (const f of findings.slice(0, 18)) {
        const at = (f.run as Run & { at: number }).at;
        lines.push(
          `  #${String(at).padStart(4)}  ${f.run.lengthFeet.toFixed(1).padStart(7)}ft` +
            `  ${((f.run.thicknessFeet ?? 0) * 12).toFixed(1).padStart(6)}in` +
            `  ${f.pairThicknessInches.toFixed(1).padStart(7)}in` +
            `  ${f.offsetInches.toFixed(1).padStart(6)}in` +
            `  ${String(f.facesNearby).padStart(4)}`,
        );
      }
      if (findings.length > 18) lines.push(`  … and ${findings.length - 18} more`);
      // eslint-disable-next-line no-console
      console.log(lines.join("\n"));
      flaggedAnywhere += findings.length;

      if (sheet === "A4.B.3") {
        const positions = new Set(findings.map((f) => (f.run as Run & { at: number }).at));
        const hit = NAMED.filter((n) => positions.has(n));
        // eslint-disable-next-line no-console
        console.log(
          `\n  of the positions Diego named (${NAMED.join(", ")}), this flags: ` +
            `${hit.length === 0 ? "NONE" : hit.join(", ")}` +
            `\n  -> ${
              hit.length >= 3
                ? "the numbering and the detector agree"
                : "they DISAGREE — do not edit labels on these positions"
            }`,
        );
      }
    }
    // The input resolved: a REAL_PLAN_DIR or a label dir that matches nothing
    // would otherwise print an empty report and pass.
    expect(
      sheetsRead.length,
      "no sheet was read at all — check REAL_PLAN_DIR and TAKEOFF_LABEL_DIR",
    ).toBeGreaterThan(0);
    expect(
      flaggedAnywhere,
      "nothing was flagged on any sheet, so this run cannot distinguish a clean set from a broken detector",
    ).toBeGreaterThan(0);
  });
});
