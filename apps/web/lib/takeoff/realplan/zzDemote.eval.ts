import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { modelVerdicts, type ScoredPairing } from "../demotedRuns";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import type { WallModel } from "../wallClassifier";
import { FEATURE_NAMES } from "../wallFeatures";

/**
 * ── THE CLASSIFIER AS THE ESTIMATOR MEETS IT: GREY-OUT, NOT VETO ──
 *
 * `zzLoboVeto` scores the model as a veto — footage the finder refuses. In the
 * app the model never hides a line: a run every pairing of which scores under
 * the cut is DEMOTED, drawn grey with one button to take it back
 * (`demotedRuns.modelVerdicts`, the exact function used here). So the numbers
 * an estimator feels are different ones:
 *
 *   - of the lines greyed out, how many were really junk (precision) — a
 *     greyed real wall costs a click to bring back;
 *   - how much of the junk on the sheet is greyed (the clicks saved);
 *   - how much real wall is greyed, in feet, per building.
 *
 * Junk and real come from the labels on the PRODUCT path (`detectForSheet` →
 * `offeredCandidates`, words handed to the triage), with the scorer's own
 * band; a run is junk when at least half of it lies on a `not-wall` verdict
 * and real when at least half lies on a wall or a trace. Unsure and
 * unlabelled runs are counted on their own lines, never as either.
 *
 *   DEMOTE_MODEL_DIR=dir   leave-one-building-out: `dir/model-<family>.json`,
 *                          `model-all.json` for a building without its own
 *   DEMOTE_MODEL=file      one model for every sheet (the shipped one, say)
 *   DEMOTE_CUT=0.2         the grey-out cut (the app's default)
 *   PROBE_OUT=file.json    one record per offered run
 *
 * A model whose columns are a PREFIX of this build's `FEATURE_NAMES` is scored
 * on that prefix — that is how a model trained before a column was appended
 * is compared with one trained after. Any other mismatch refuses.
 * TRAINING sheets only (`heldOutReason`).
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const MODEL_DIR = process.env.DEMOTE_MODEL_DIR ?? "";
const MODEL_FILE = process.env.DEMOTE_MODEL ?? "";
const CUT = Number(process.env.DEMOTE_CUT ?? "0.2");
const OUT = process.env.PROBE_OUT ?? "";

const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
function findPdf(dir: string): string | null {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const name of readdirSync(root)) if (name.toLowerCase().endsWith(".pdf") && flat(name) === flat(dir)) return join(root, name);
  return null;
}
const familyOf = (set: string) => set.toLowerCase().replace(/\.pdf$/, "").replace(/[^a-z0-9]+/g, "-");
type G = { x1: number; y1: number; x2: number; y2: number };
type Verdict = G & { lengthFeet: number; thicknessFeet?: number; verdict: string };
type Saved = { set?: string; page: number; feetPerUnit: number; verdicts: Verdict[] };
const len = (g: G) => Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
const parallel = (a: G, b: G) => { const p = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), q = Math.atan2(b.y2 - b.y1, b.x2 - b.x1); return Math.abs(Math.cos(p - q)) >= 0.97; };
function offLine(a: G, px: number, py: number): number { const l = len(a); if (l === 0) return Math.hypot(px - a.x1, py - a.y1); return Math.abs((a.x2 - a.x1) * (a.y1 - py) - (a.x1 - px) * (a.y2 - a.y1)) / l; }
function overlapAlong(a: G, b: G): number { const la = len(a); if (la === 0) return 0; const ux = (a.x2 - a.x1) / la, uy = (a.y2 - a.y1) / la; const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy; const b1 = at(b.x1, b.y1), b2 = at(b.x2, b.y2); return Math.max(0, Math.min(la, Math.max(b1, b2)) - Math.max(0, Math.min(b1, b2))); }
const band = (aTh: number, bTh: number, fpu: number) => Math.min(3, Math.max(1.5, Math.max(aTh, bTh) / 2 + 0.5)) / fpu;
function coveredFeet(a: G & { th: number }, others: readonly (G & { th: number })[], fpu: number): number {
  let covered = 0;
  for (const o of others) { if (!parallel(a, o)) continue; if (Math.max(offLine(a, o.x1, o.y1), offLine(a, o.x2, o.y2)) > band(a.th, o.th, fpu)) continue; covered += overlapAlong(a, o); }
  return Math.min(len(a), covered) * fpu;
}

/** The model, with the pairings' features cut to its columns when they are a prefix of ours. */
function prepare(model: WallModel): { model: WallModel; take: number } {
  const n = model.features.length;
  expect(n, "a model with more columns than this build has features").toBeLessThanOrEqual(FEATURE_NAMES.length);
  for (let i = 0; i < n; i += 1) expect(model.features[i], `column ${i} of the model`).toBe(FEATURE_NAMES[i]);
  return { model, take: n };
}

describe.skipIf(DIR === "" || LABELS === "" || (MODEL_DIR === "" && MODEL_FILE === ""))("the classifier in grey-out mode, as the estimator meets it", () => {
  it("greys out junk and leaves real walls alone, per building", { timeout: 7_200_000 }, async () => {
    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir))) continue;
      // DEMOTE_HELD_OUT=1: the HELD-OUT sets instead, for a before/after delta
      // of one model against another — never for choosing a cut or a feature.
      if (process.env.DEMOTE_HELD_OUT === "1" ? heldOutReason(dir) === null : heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(join(LABELS, dir))) {
        if (!name.endsWith(".json")) continue;
        const sheet = name.replace(/\.json$/, "");
        // A sheet that is the wrong question (Michigan A3's existing walls) — see `EXCLUDED_SHEETS`.
        if (excludedSheetReason(dir, sheet) !== null) continue;
        files.push({ dir, sheet });
      }
    }
    files.sort((a, b) => a.dir.localeCompare(b.dir) || a.sheet.localeCompare(b.sheet));
    const models = new Map<string, { model: WallModel; take: number }>();
    const fixed = MODEL_FILE === "" ? null : prepare(JSON.parse(readFileSync(MODEL_FILE, "utf8")) as WallModel);
    type Tally = { greyed: number; greyedJunk: number; greyedReal: number; greyedOther: number; junk: number; real: number; runs: number; greyedRuns: number };
    const fresh = (): Tally => ({ greyed: 0, greyedJunk: 0, greyedReal: 0, greyedOther: 0, junk: 0, real: 0, runs: 0, greyedRuns: 0 });
    const perBuilding = new Map<string, Tally>();
    const total = fresh();
    const records: Record<string, unknown>[] = [];
    for (const file of files) {
      const pdf = findPdf(file.dir);
      if (pdf === null) continue;
      const saved = JSON.parse(readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8")) as Saved;
      const family = familyOf(saved.set === undefined || saved.set === "" ? file.dir : saved.set);
      const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
      if (strokes === null) continue;
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(saved.page);
      await doc.close();
      const W = strokes.widthPt; const fpu = saved.feetPerUnit;
      const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      let scored = fixed;
      if (scored === null) {
        if (!models.has(family)) {
          const own = join(MODEL_DIR, `model-${family}.json`);
          const path = existsSync(own) ? own : join(MODEL_DIR, "model-all.json");
          if (!existsSync(own)) console.log(`  (${family}: no fold model of its own, scored with model-all)`);
          expect(existsSync(path), `no model for ${family} at ${path}`).toBe(true);
          models.set(family, prepare(JSON.parse(readFileSync(path, "utf8")) as WallModel));
        }
        scored = models.get(family)!;
      }
      const take = scored.take;
      const pairings: ScoredPairing[] = [];
      const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (features, wall) => pairings.push({ x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2, thicknessFeet: wall.thicknessFeet, features: features.slice(0, take) }) });
      const offered = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W })), widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
      const runs = offered.candidates.map((c) => ({ x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, thicknessFeet: (c.thicknessIn ?? 0) / 12, lengthFeet: c.lengthFeet }));
      const verdicts = modelVerdicts(scored.model, CUT, runs, pairings, fpu);
      const toRun = (v: Verdict) => ({ ...v, th: v.thicknessFeet ?? 0 });
      const real = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced").map(toRun);
      const rejected = saved.verdicts.filter((v) => v.verdict === "not-wall").map(toRun);
      const words = textItems.map((i) => ({ str: i.str.trim(), x: (i.x + i.width / 2) / W, y: (i.y - i.height / 2) / W }));
      const tally = perBuilding.get(family) ?? fresh();
      runs.forEach((run, at) => {
        const me = { ...run, th: run.thicknessFeet };
        const L = run.lengthFeet;
        const realC = coveredFeet(me, real, fpu), rej = coveredFeet(me, rejected, fpu);
        const status = realC >= 0.5 * L ? "real" : rej >= 0.5 * L ? "junk" : "other";
        const v = verdicts.get(at);
        const greyed = v !== undefined;
        for (const t of [tally, total]) {
          t.runs += 1;
          if (status === "junk") t.junk += L; else if (status === "real") t.real += L;
          if (greyed) { t.greyedRuns += 1; t.greyed += L; if (status === "junk") t.greyedJunk += L; else if (status === "real") t.greyedReal += L; else t.greyedOther += L; }
        }
        const mx = (run.x1 + run.x2) / 2, my = (run.y1 + run.y2) / 2;
        const numbersNear = words.filter((w) => /^\d{1,3}$/.test(w.str) && Math.hypot(w.x - mx, w.y - my) * fpu <= 6).length;
        // the best-scoring pairing along the run carries the features reported
        let bestScore = -1; let bestFeatures: number[] | null = null;
        for (const p of pairings) { const s = v?.score; void s; if (!parallel(run, p)) continue; if (offLine(run, (p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2) > Math.max(run.thicknessFeet, p.thicknessFeet, 0.1) / fpu) continue; if (overlapAlong(run, p) < 0.5 * len(p)) continue; const sc = v?.score ?? -1; if (bestFeatures === null || sc > bestScore) { bestScore = sc; bestFeatures = p.features; } }
        records.push({ set: file.dir, sheet: file.sheet, family, L: +L.toFixed(1), thIn: +(run.thicknessFeet * 12).toFixed(1), status, greyed, score: v?.score ?? null, numbersNear, features: bestFeatures, x1: run.x1, y1: run.y1, x2: run.x2, y2: run.y2 });
      });
      perBuilding.set(family, tally);
    }
    const line = (name: string, t: Tally) => {
      const labelled = t.greyedJunk + t.greyedReal;
      const precision = labelled > 0 ? (100 * t.greyedJunk) / labelled : 0;
      const share = t.junk > 0 ? (100 * t.greyedJunk) / t.junk : 0;
      return `  ${name.padEnd(30)} greyed ${t.greyedRuns.toString().padStart(4)}/${t.runs.toString().padStart(4)} runs ${t.greyed.toFixed(0).padStart(6)} ft · junk greyed ${t.greyedJunk.toFixed(0).padStart(5)} of ${t.junk.toFixed(0).padStart(5)} (${share.toFixed(0).padStart(3)}%) · real greyed ${t.greyedReal.toFixed(0).padStart(5)} of ${t.real.toFixed(0).padStart(6)} · precision ${precision.toFixed(0).padStart(3)}% · other greyed ${t.greyedOther.toFixed(0)}`;
    };
    console.log(`\nGREY-OUT AT ${CUT} — ${MODEL_FILE !== "" ? MODEL_FILE : `leave-one-building-out from ${MODEL_DIR}`}`);
    for (const [family, t] of [...perBuilding].sort((a, b) => b[1].junk - a[1].junk)) console.log(line(family, t));
    console.log(line("TOTAL", total));
    if (OUT !== "") writeFileSync(OUT, JSON.stringify(records));
    expect(files.length).toBeGreaterThan(0);
    expect(total.runs).toBeGreaterThan(0);
  });
});
