import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import type { ScoredPairing } from "../demotedRuns";
import { runsHeldOffEstimate } from "../estimateHold";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { reviewOrder, runScores } from "../wallReview";
import { sheetStrokes } from "../sheetStrokes";
import { loadWallModel } from "../wallModelFile";
import type { WallCandidate } from "../wallVectors";

/**
 * ── HOW MANY RUNS A REVIEWER MUST LOOK AT ──
 *
 * The labels play the reviewer: each run in review order is dropped when the key
 * calls it junk, and a held run is kept when the key calls it wall. Counts the
 * runs looked at until walls posted are within +10% of the key, in the shipped
 * order (`wallReview.reviewOrder`) and, for comparison, longest first. Training
 * only. Needs TAKEOFF_WALL_MODEL. Writes PROBE_OUT.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const TARGET = 1.1;
const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type Saved = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number };

describe.skipIf(DIR === "" || LABELS === "" || process.env.TAKEOFF_WALL_MODEL === undefined)("runs a reviewer looks at", () => {
  it("simulates the review on each sheet", { timeout: 7_200_000 }, async () => {
    const config = loadWallModel();
    if (config === null) throw new Error("no wall model");
    const rows: unknown[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir)) || heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(join(LABELS, dir))) {
        const sheet = name.slice(0, -5);
        if (!name.endsWith(".json") || excludedSheetReason(dir, sheet) !== null) continue;
        const pdf = findPdf(dir);
        if (pdf === null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Saved;
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null || strokes.segments.length < 50) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        await doc.close();
        const W = strokes.widthPt;
        const fpu = saved.feetPerUnit;
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const scored: ScoredPairing[] = [];
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (f, w) => { scored.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet, features: [...f] }); } });
        const runs = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems }).offeredRuns;
        const { key } = keyFromLabels(saved);
        if (key.length === 0) continue;
        const one = (r: WallCandidate) => scoreSheet({ set: dir, sheet, key, proposed: [{ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, thicknessFeet: r.thicknessFeet } as ScoredRun], feetPerUnit: fpu });
        const keyFeet = one(runs[0] ?? (key[0] as unknown as WallCandidate)).keyFeet;
        const junk = runs.map((r) => one(r).extraFeet >= 0.5 * r.lengthFeet);
        const held = new Set(runsHeldOffEstimate(config.model, runs, scored, fpu, false));
        const scores = runScores(config.model, runs, scored, fpu);
        const simulate = (order: number[]) => {
          let posted = runs.reduce((n, r) => n + (held.has(r) ? 0 : r.lengthFeet), 0);
          if (posted <= TARGET * keyFeet) return { looked: 0, reached: true, posted };
          let looked = 0;
          for (const at of order) {
            looked += 1;
            const r = runs[at]!;
            if (!held.has(r) && junk[at]) posted -= r.lengthFeet;
            if (held.has(r) && !junk[at]) posted += r.lengthFeet;
            if (posted <= TARGET * keyFeet) return { looked, reached: true, posted };
          }
          return { looked, reached: false, posted };
        };
        const entries = runs.map((r, at) => ({ at, held: held.has(r), score: scores[at] ?? null, lengthFeet: r.lengthFeet }));
        rows.push({
          set: dir,
          sheet,
          runs: runs.length,
          key: Math.round(keyFeet),
          byDoubt: simulate(reviewOrder(entries, "doubt")),
          longestFirst: simulate(reviewOrder(entries, "longest")),
          likelyJunkFeet: simulate(reviewOrder(entries, "likely junk feet")),
        });
      }
    }
    writeFileSync(process.env.PROBE_OUT ?? "/dev/null", JSON.stringify(rows));
    expect(rows.length, "no training sheet was read").toBeGreaterThan(0);
  });
});
