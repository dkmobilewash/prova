import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { modelVerdicts, type ScoredPairing } from "../demotedRuns";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import { loadWallModel } from "../wallModelFile";

/**
 * ── WHAT THE ESTIMATE WOULD CARRY IF THE GREY-OUT STAYED OFF IT ──
 *
 * For each labelled sheet: feet offered, then feet left after runs the model
 * doubts are held back, at several cuts, scored against the key. Training is
 * per sheet. Held-out is written as one total per cut and nothing finer. The
 * model was trained on the training sheets, so that half flatters it. No model
 * call. Needs TAKEOFF_WALL_MODEL. Writes PROBE_OUT.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const CUTS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5];
const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type Saved = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number };
type Tally = { key: number; offered: number; extra: number; missing: number; after: Record<string, { posted: number; extra: number; missing: number }> };

describe.skipIf(DIR === "" || LABELS === "" || process.env.TAKEOFF_WALL_MODEL === undefined)("the estimate with the grey-out held back", () => {
  it("scores each cut", { timeout: 7_200_000 }, async () => {
    const config = loadWallModel();
    if (config === null) throw new Error("no wall model");
    const rows: unknown[] = [];
    const held: Tally = { key: 0, offered: 0, extra: 0, missing: 0, after: {} };
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir))) continue;
      const isHeld = heldOutReason(dir) !== null;
      for (const name of readdirSync(join(LABELS, dir))) {
        const sheet = name.slice(0, -5);
        if (!name.endsWith(".json") || (!isHeld && excludedSheetReason(dir, sheet) !== null)) continue;
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
        const pairings: ScoredPairing[] = [];
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (f, w) => { pairings.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet, features: [...f] }); } });
        const offered = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
        const { key } = keyFromLabels(saved);
        const runs = offered.offeredRuns;
        const score = (kept: typeof runs) => scoreSheet({ set: dir, sheet, key, proposed: kept.map((w): ScoredRun => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, lengthFeet: w.lengthFeet, thicknessFeet: w.thicknessFeet }) as ScoredRun), feetPerUnit: fpu });
        const base = score(runs);
        const row: Tally = { key: base.keyFeet, offered: base.proposedFeet, extra: base.extraFeet, missing: base.missingFeet, after: {} };
        const scored = modelVerdicts({ ...config.model }, 1.01, runs, pairings, fpu);
        for (const cut of CUTS) {
          const doubted = new Set([...scored].filter(([, v]) => (v.score ?? 1) < cut).map(([at]) => at));
          const s = score(runs.filter((_, at) => !doubted.has(at)));
          row.after[cut] = { posted: s.proposedFeet, extra: s.extraFeet, missing: s.missingFeet };
        }
        if (isHeld) {
          held.key += row.key; held.offered += row.offered; held.extra += row.extra; held.missing += row.missing;
          for (const cut of CUTS) {
            const h = (held.after[cut] ??= { posted: 0, extra: 0, missing: 0 });
            h.posted += row.after[cut]!.posted; h.extra += row.after[cut]!.extra; h.missing += row.after[cut]!.missing;
          }
        } else rows.push({ set: dir, sheet, ...row });
      }
    }
    writeFileSync(process.env.PROBE_OUT ?? "/dev/null", JSON.stringify({ cutShipped: config.cut, training: rows, held }));
    expect(rows.length, "no training sheet was read").toBeGreaterThan(0);
  });
});
