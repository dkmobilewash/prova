import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layerVerdict } from "../layerNames";
import { offsetCandidates, type Run } from "../offsetCandidates";
import { sheetStrokes } from "../sheetStrokes";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── IS GROUP B THE DETECTOR PICKING GRID LINES? ──
 *
 * The offset check ranks candidate face pairs by how LONG their faces are,
 * because a wall's two faces both run the length of the wall and a shelf does
 * not. Grid and column lines break that: they run past the building at both
 * ends, are drawn in pairs, and so win the ranking whenever they are near. 23
 * of 62 findings chose a pair under five inches apart, with `(4.1in apart,
 * 8.1in off)` repeating five times.
 *
 * That is a suspicion, and this is the test. It asks the one source that can
 * settle it without looking at the drawing: **the CAD layer the drafter put
 * the line on.** `layerNames.ts` already reads `S-GRID` and its relatives, and
 * is used elsewhere for exactly this.
 *
 * ── THE CONTROL IS WHETHER THESE SHEETS CARRY LAYERS AT ALL ──
 *
 * If the export has no optional-content groups, every segment's layer is
 * undefined, every verdict is "unknown", and this eval would report "no grid
 * lines found" — which reads as the suspicion being refuted when it has merely
 * gone unasked. So the layer coverage of the whole sheet is printed first and
 * asserted, and a sheet without layers is reported as UNTESTABLE rather than
 * as clean.
 *
 *     REAL_PLAN_DIR=… TAKEOFF_LABEL_DIR=… npx vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan/zzOffsetWhy.eval.ts
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

type Saved = { feetPerUnit: number; verdicts: (Run & { verdict: string })[] };

/** The segments lying along a face, by perpendicular offset from a run. */
function segmentsNearFace(
  run: Run,
  segments: readonly StrokeSegment[],
  faceOffset: number,
  toleranceUnits: number,
): StrokeSegment[] {
  const dx = run.x2 - run.x1;
  const dy = run.y2 - run.y1;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return [];
  const ux = dx / len;
  const uy = dy / len;
  const out: StrokeSegment[] = [];
  for (const seg of segments) {
    const sx = seg.x2 - seg.x1;
    const sy = seg.y2 - seg.y1;
    const slen = Math.hypot(sx, sy);
    if (!(slen > 0)) continue;
    if (Math.abs((sx / slen) * uy - (sy / slen) * ux) > 0.035) continue;
    const n1 = -(seg.x1 - run.x1) * uy + (seg.y1 - run.y1) * ux;
    const n2 = -(seg.x2 - run.x1) * uy + (seg.y2 - run.y1) * ux;
    if (Math.abs((n1 + n2) / 2 - faceOffset) > toleranceUnits) continue;
    const t1 = ((seg.x1 - run.x1) * ux + (seg.y1 - run.y1) * uy) / len;
    const t2 = ((seg.x2 - run.x1) * ux + (seg.y2 - run.y1) * uy) / len;
    if (Math.max(t1, t2) < -1 || Math.min(t1, t2) > 2) continue;
    out.push(seg);
  }
  return out;
}

describe.skipIf(DIR === "" || LABELS === "")("why group B was flagged", () => {
  it("asks the layer whether the chosen pair is a grid line", { timeout: 3_600_000 }, async () => {
    const sheetsRead: string[] = [];
    for (const [sheet, page] of SHEETS) {
      const saved = JSON.parse(
        readFileSync(join(LABELS, LABEL_SET, `${sheet}.json`), "utf8"),
      ) as Saved;
      const read = await sheetStrokes(Buffer.from(readFileSync(join(DIR, SET))), page);
      expect(read, `${sheet}: unreadable`).not.toBeNull();
      if (read === null) continue;
      sheetsRead.push(sheet);
      const W = read.widthPt;
      const segments = read.segments.map((s) => ({
        ...s,
        x1: s.x1 / W,
        y1: s.y1 / W,
        x2: s.x2 / W,
        y2: s.y2 / W,
      }));

      // ── THE CONTROL, BEFORE ANY FINDING IS READ ──
      const withLayer = segments.filter((s) => s.layer !== undefined).length;
      const named = new Map<string, number>();
      for (const s of segments) {
        if (s.layer !== undefined) named.set(s.layer, (named.get(s.layer) ?? 0) + 1);
      }
      const share = (withLayer / Math.max(1, segments.length)) * 100;
      // eslint-disable-next-line no-console
      console.log(
        `\n${sheet} (p${page}) — ${segments.length.toLocaleString()} segments, ` +
          `${share.toFixed(0)}% carry a layer, ${named.size} distinct` +
          (named.size === 0
            ? "\n  UNTESTABLE: this export carries no layers, so the grid question cannot be asked of it"
            : `\n  layers: ${[...named]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([n, c]) => `${n}(${c})`)
                .join(" ")}`),
      );

      const accepted = saved.verdicts
        .map((v, i) => ({ ...v, at: i + 1 }))
        .filter((v) => v.verdict === "wall");
      const findings = offsetCandidates({ runs: accepted, segments, feetPerUnit: saved.feetPerUnit });

      const tol = (0.75 / 12 / saved.feetPerUnit) * 2;
      const rows: string[] = [];
      let gridPairs = 0;
      for (const f of findings) {
        const at = (f.run as Run & { at: number }).at;
        const verdicts = f.pairFaces.map((off) => {
          const segs = segmentsNearFace(f.run, segments, off, tol);
          const names = new Set(segs.map((s) => s.layer).filter((l): l is string => l !== undefined));
          const kinds = new Set([...names].map((n) => layerVerdict(n)));
          return { names: [...names], kinds: [...kinds] };
        });
        const anyNotWall = verdicts.some((v) => v.kinds.includes("not-wall"));
        if (anyNotWall) gridPairs += 1;
        rows.push(
          `  #${String(at).padStart(4)}  pair ${f.pairThicknessInches.toFixed(1).padStart(5)}in` +
            ` face ${f.pairFaceFeet.toFixed(0).padStart(4)}ft  off ${f.offsetInches.toFixed(1).padStart(5)}in` +
            `  layers: ${verdicts
              .map((v) => (v.names.length === 0 ? "—" : v.names.join("/")))
              .join("  |  ")}` +
            (anyNotWall ? "   <- NOT A WALL LAYER" : ""),
        );
      }
      // eslint-disable-next-line no-console
      console.log(
        `  ${findings.length} flagged, ${gridPairs} whose chosen pair sits on a non-wall layer\n` +
          rows.slice(0, 14).join("\n") +
          (rows.length > 14 ? `\n  … and ${rows.length - 14} more` : ""),
      );
    }
    expect(sheetsRead.length, "no sheet was read — check REAL_PLAN_DIR").toBeGreaterThan(0);
  });
});
