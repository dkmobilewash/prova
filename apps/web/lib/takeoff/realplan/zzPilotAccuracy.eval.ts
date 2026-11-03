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
import { sheetStrokes } from "../sheetStrokes";
import { loadWallModel } from "../wallModelFile";
import type { WallCandidate } from "../wallVectors";

/**
 * ── WHAT A CAREFUL ESTIMATOR GETS ──
 *
 * Walls posted against the key on each training sheet: (a) as offered, (b) with
 * one work-area box drawn round the key's walls, (c) the box and up to three
 * "exclude like this" clicks. The clicks are the best a careful estimator could
 * do: each round tries the ten longest junk runs and keeps the click removing
 * most junk, a foot of real wall lost counting as three of junk. The doubted
 * runs held off the estimate (`estimateHold.ts`) are applied in every arm.
 * Training only. Needs TAKEOFF_WALL_MODEL. Writes PROBE_OUT.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const BOX_MARGIN_FEET = 3;
const CLICKS = 3;
const TRIES = 10;
const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type Saved = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number; verdicts: { x1: number; y1: number; x2: number; y2: number; verdict: string }[] };
type Line = { x1: number; y1: number; x2: number; y2: number };

describe.skipIf(DIR === "" || LABELS === "" || process.env.TAKEOFF_WALL_MODEL === undefined)("what a careful estimator gets", () => {
  it("scores each sheet three ways", { timeout: 7_200_000 }, async () => {
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
        const { key } = keyFromLabels(saved);
        if (key.length === 0) continue;
        const offer = (user?: { excludeLike: Line[]; workArea: { xs: number[]; ys: number[] }[] }) =>
          offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems, ...(user === undefined ? {} : { user }) }).offeredRuns;
        const posted = (runs: WallCandidate[]) => {
          const held = new Set(runsHeldOffEstimate(config.model, runs, scored, fpu, false));
          return runs.filter((r) => !held.has(r));
        };
        const score = (runs: WallCandidate[]) => {
          const s = scoreSheet({ set: dir, sheet, key, proposed: runs.map((w): ScoredRun => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, lengthFeet: w.lengthFeet, thicknessFeet: w.thicknessFeet }) as ScoredRun), feetPerUnit: fpu });
          return { key: Math.round(s.keyFeet), posted: Math.round(s.proposedFeet), missing: Math.round(s.missingFeet), extra: Math.round(s.extraFeet) };
        };
        const offered = offer();
        const xs = key.flatMap((k) => [k.x1, k.x2]);
        const ys = key.flatMap((k) => [k.y1, k.y2]);
        const m = BOX_MARGIN_FEET / fpu;
        const [x0, x1, y0, y1] = [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...ys) - m, Math.max(...ys) + m];
        const box = { xs: [x0, x1, x1, x0], ys: [y0, y0, y1, y1] };
        const boxed = offer({ excludeLike: [], workArea: [box] });
        // The clicks: what a careful estimator would press, the best of the longest junk.
        const clicks: Line[] = [];
        let best = score(posted(boxed));
        const value = (s: ReturnType<typeof score>) => -s.extra - 3 * s.missing;
        let current = boxed;
        for (let round = 0; round < CLICKS; round += 1) {
          const keyAt = (r: WallCandidate) => scoreSheet({ set: dir, sheet, key, proposed: [{ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, thicknessFeet: r.thicknessFeet } as ScoredRun], feetPerUnit: fpu }).extraFeet;
          const junk = [...current].filter((r) => keyAt(r) >= 0.5 * r.lengthFeet).sort((a, b) => b.lengthFeet - a.lengthFeet).slice(0, TRIES);
          let pick: { line: Line; runs: WallCandidate[]; s: ReturnType<typeof score> } | null = null;
          for (const r of junk) {
            const line = { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 };
            const runs = offer({ excludeLike: [...clicks, line], workArea: [box] });
            const s = score(posted(runs));
            if (value(s) > value(pick?.s ?? best)) pick = { line, runs, s };
          }
          if (pick === null) break;
          clicks.push(pick.line);
          best = pick.s;
          current = pick.runs;
        }
        rows.push({ set: dir, sheet, asOffered: score(offered), withHold: score(posted(offered)), box: score(posted(boxed)), boxClicks: best, clicks: clicks.length });
      }
    }
    writeFileSync(process.env.PROBE_OUT ?? "/dev/null", JSON.stringify(rows));
    expect(rows.length, "no training sheet was read").toBeGreaterThan(0);
  });
});
