import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageInventoryWork, type SheetProposalRow } from "../../plan-ingest/pageInventory";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { MODEL_EVIDENCE } from "../autoPost";
import type { ScoredPairing } from "../demotedRuns";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { productDetection, productSheetRuns, sampledSheetsFor } from "../productDetection";
import { priorPlanFor } from "../priorPlan";
import { autoPairs } from "../priorPlanLoad";
import { sheetStrokes } from "../sheetStrokes";
import { scoreCandidate, type WallModel } from "../wallClassifier";
import { loadWallModel } from "../wallModelFile";
import { loadRenoModel, loadRunModel, priorForRuns, renoModelRemovals, RUN_REMOVE_BELOW, runModelRows, runModelVerdicts } from "../wallRunModel";

/**
 * ── THE RUN MODEL AS RUN TAKEOFF APPLIES IT: GATE OFF vs ON, AND PARITY WITH THE EXAM'S ROWS ──
 *
 * Every keyed sheet goes through the product's own Run takeoff path for a new company
 * (`productDetection`, `productSheetRuns`, the zero-touch demolition pairing `autoPairs` +
 * `priorPlanFor`, then `runModelVerdicts` — the calls `detectWallsForCalibration` makes), and
 * presses nothing. Per sheet, in feet of wall:
 *
 *   GATE OFF  posted = what the hand chain posts (kept by the compare, not held by the pairwise model);
 *   GATE ON   posted = the same minus the runs the run model holds back (score < 0.10);
 *   error     = junk posted + real left off, over every run on offer — loso.py's `err`, so the totals
 *               are directly comparable with the LOSO report and the held-out exam;
 *   auto-post = posted runs at or above MODEL_EVIDENCE.walls' line: ft ok / false.
 *
 * Training scores each set with its OWN LOSO fold (`scripts/wall-model/folds.py` → RG_FOLDS/<set>.json);
 * a set with no fold never trained the model, so the committed one is already out-of-sample for it and
 * is used (listed). Held-out (RG_HELD=1) uses TAKEOFF_WALL_RUN_MODEL.
 *
 * R (TAKEOFF_WALL_RENO_MODEL set): BOTH arms keep the run model on, as production runs them together —
 * gate OFF = the run model alone, gate ON = the run model AND R (`renoModelRemovals`), R scored by its
 * own LOSO fold (`folds.py --reno` → RG_RENO_FOLDS/<set>.json) or, for a set R never trained on, the
 * committed R.
 *
 * PARITY (RG_TABLE = the feature table the model was examined on): for every sheet in that table, the
 * product's rows scored by the committed run model must equal the table's rows scored by it, run for run.
 * RG_PARITY_SHEETS ("set|sheet;…") names the sheets that MUST be present and equal.
 *
 * Needs REAL_PLAN_DIR, TAKEOFF_LABEL_DIR, RG_OUT, TAKEOFF_WALL_MODEL and TAKEOFF_WALL_RUN_MODEL.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.RG_OUT ?? "";
const HELD = process.env.RG_HELD === "1";
const FOLDS = process.env.RG_FOLDS ?? "";
const RENO_FOLDS = process.env.RG_RENO_FOLDS ?? "";
const TABLE = process.env.RG_TABLE ?? "";
const MUST = (process.env.RG_PARITY_SHEETS ?? "").split(";").filter((s) => s !== "");
const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type Saved = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number };

async function sheetsOf(pdf: string): Promise<{ pageNumber: number; sheetNumber: string | null; title: string | null }[]> {
  const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
  const proposals = new Map<number, SheetProposalRow>();
  const work = pageInventoryWork(
    { planId: "p", companyId: "c", ingestJobId: "i", jobId: "j", startedByUserId: null },
    {
      readPlanBytes: async () => ({ ok: true, bytes: Buffer.from("") }),
      openPdf: async () => doc,
      saveSheetText: async () => {},
      saveScaleReading: async () => {},
      saveSheetProposal: async (r) => void proposals.set(r.pageNumber, r),
      sheetNamesOn: async () => true,
    },
  );
  for (let page = 1; page <= doc.pageCount; page += 1) {
    try {
      await work({ id: `t${page}`, pageNumber: page, stage: "PAGE_INVENTORY", attempts: 0 } as never);
    } catch {
      // an unreadable page is not paired
    }
  }
  await doc.close();
  return [...proposals.values()].map((p) => ({ pageNumber: p.pageNumber, sheetNumber: p.sheetNumber, title: p.title }));
}

/** The exam table's rows by "set|sheet", in table order. */
function tableRows(): Map<string, number[][]> {
  const out = new Map<string, number[][]>();
  if (TABLE === "") return out;
  for (const line of readFileSync(TABLE, "utf8").split("\n")) {
    if (line === "") continue;
    const r = JSON.parse(line) as { set?: string; sheet?: string; x?: number[] };
    if (r.x === undefined) continue;
    const k = `${r.set}|${r.sheet}`;
    out.set(k, [...(out.get(k) ?? []), r.x]);
  }
  return out;
}

const round4 = (v: number) => +v.toFixed(4);

describe.skipIf(DIR === "" || LABELS === "" || OUT === "" || process.env.TAKEOFF_WALL_MODEL === undefined || process.env.TAKEOFF_WALL_RUN_MODEL === undefined)("the run model at Run takeoff, gate off vs on", () => {
  it("measures every keyed sheet through the product's path", { timeout: 14_400_000 }, async () => {
    const pair = loadWallModel();
    const shipped = loadRunModel();
    // R, when its variable is set: then BOTH arms run the run model and the gate is R off vs on.
    const renoShipped = loadRenoModel();
    const renoFolded: string[] = [];
    if (pair === null || shipped === null) throw new Error("TAKEOFF_WALL_MODEL and TAKEOFF_WALL_RUN_MODEL must both load");
    const line = MODEL_EVIDENCE.walls.autoPostAt;
    if (line === null) throw new Error("no walls auto-post line");
    const table = tableRows();
    const parity: { sheet: string; rows: number; maxDiff: number; equal: boolean }[] = [];
    const skipped: string[] = [];
    const bySet = new Map<string, { off: number; on: number; removedOk: number; removedJunk: number; autoOk: number; autoFalse: number; offered: number }>();
    for (const dir of readdirSync(LABELS).sort()) {
      if (!existsSync(join(LABELS, dir)) || (heldOutReason(dir) !== null) !== HELD) continue;
      if (process.env.RG_ONLY !== undefined && !dir.includes(process.env.RG_ONLY)) continue;
      let names: string[] = [];
      try { names = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")); } catch { continue; }
      const pdf = findPdf(dir);
      if (pdf === null || names.length === 0) continue;
      let runModel: WallModel = shipped;
      let renoModel = renoShipped;
      if (!HELD) {
        const fold = existsSync(join(FOLDS, `${dir}.json`)) ? loadRunModel({ TAKEOFF_WALL_RUN_MODEL: join(FOLDS, `${dir}.json`) }) : null;
        if (fold === null) skipped.push(dir);
        else runModel = fold;
        if (renoShipped !== null && RENO_FOLDS !== "" && existsSync(join(RENO_FOLDS, `${dir}.json`))) {
          renoModel = loadRenoModel({ TAKEOFF_WALL_RENO_MODEL: join(RENO_FOLDS, `${dir}.json`) });
          if (renoModel === null) throw new Error(`R fold unreadable for ${dir}`);
          renoFolded.push(dir);
        }
      }
      const auto = autoPairs(await sheetsOf(pdf));
      for (const name of names) {
        const sheet = name.slice(0, -5);
        if (excludedSheetReason(dir, sheet) !== null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Saved;
        const { key } = keyFromLabels(saved, saved.feetPerUnit);
        if (key.length === 0) continue;
        const bytes = Buffer.from(readFileSync(pdf));
        const strokes = await sheetStrokes(bytes, saved.page);
        if (strokes === null || strokes.segments.length < 50) continue;
        const doc = await openPlanPdf(bytes);
        const textItems = (await doc.pageText(saved.page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const W = strokes.widthPt, fpu = saved.feetPerUnit;
        // Run takeoff for a new company: no types, no legend (`detectWallsForCalibration`).
        const pairings: ScoredPairing[] = [];
        const sampledSheets = await sampledSheetsFor({ pageCount: doc.pageCount, pageNumber: saved.page, own: strokes, read: (p) => doc.pageStrokes(p) });
        const detected = productDetection(
          { segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, wallTypes: [], legendCodes: null, scanned: false, sampledSheets },
          (f, w) => { pairings.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet, features: [...f] }); },
        );
        const offer = (priorPlan?: { lines: NonNullable<ReturnType<typeof priorPlanFor>["lines"]>; sheet: string }) =>
          productSheetRuns({ detected, segmentsPt: strokes.segments, widthPt: W, feetPerUnit: fpu, textItems, ...(priorPlan === undefined ? {} : { priorPlan }) }).offeredRuns;
        const offered = offer();
        let kept = offered;
        let prior: ReturnType<typeof priorForRuns>;
        const paired = auto.get(saved.page);
        if (paired !== undefined) {
          const ds = await doc.pageStrokes(paired.demoPage);
          const dt = (await doc.pageText(paired.demoPage)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
          const pp = priorPlanFor({ demo: { segments: ds.segments, textItems: dt, widthPt: ds.widthPt, heightPt: ds.heightPt }, newPage: { segments: strokes.segments, widthPt: W }, newRuns: offered, feetPerUnit: fpu });
          if (pp.lines !== null) kept = offer({ lines: pp.lines, sheet: `p${paired.demoPage}` });
          prior = priorForRuns(pp, ds, fpu, W);
        }
        await doc.close();
        const input = { offered, kept, pairings, pairModel: pair.model, segments: strokes.segments, textItems, widthPt: W, feetPerUnit: fpu, ...(prior === undefined ? {} : { prior }) };
        const built = runModelRows(input);
        const verdicts = runModelVerdicts(input, runModel);
        const removed = new Set(verdicts.removed.map((r) => `${r.x1},${r.y1},${r.x2},${r.y2}`));
        const renoRemoved = new Set(renoModel === null ? [] : renoModelRemovals(input, renoModel).map((r) => `${r.x1},${r.y1},${r.x2},${r.y2}`));
        const scoreOfKept = new Map(kept.map((r, at) => [`${r.x1},${r.y1},${r.x2},${r.y2}`, verdicts.scores[at]!]));

        // Parity with the exam's table: the committed model on the product's rows vs on the table's.
        const examRows = table.get(`${dir}|${sheet}`);
        if (examRows !== undefined) {
          const mine = built.rows.map((x) => scoreCandidate(shipped, x.map(round4)));
          const theirs = examRows.map((x) => scoreCandidate(shipped, x));
          const maxDiff = mine.length === theirs.length ? Math.max(0, ...mine.map((s, i) => Math.abs(s - theirs[i]!))) : Number.POSITIVE_INFINITY;
          parity.push({ sheet: `${dir}|${sheet}`, rows: mine.length, maxDiff, equal: maxDiff < 1e-6 });
        }

        const s = bySet.get(dir) ?? { off: 0, on: 0, removedOk: 0, removedJunk: 0, autoOk: 0, autoFalse: 0, offered: 0 };
        offered.forEach((r, i) => {
          const extra = Math.min(r.lengthFeet, scoreSheet({ set: dir, sheet, key, proposed: [{ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, thicknessFeet: r.thicknessFeet } as ScoredRun], feetPerUnit: fpu }).extraFeet);
          const ok = r.lengthFeet - extra;
          const handPosts = built.kept[i]! && !built.heldOff[i]!;
          // The kept twin of this run (the compare re-offers kept runs as new objects).
          const twin = kept.find((q) => Math.abs(q.x1 - r.x1) < 5e-6 && Math.abs(q.y1 - r.y1) < 5e-6 && Math.abs(q.x2 - r.x2) < 5e-6 && Math.abs(q.y2 - r.y2) < 5e-6);
          const twinKey = twin === undefined ? "" : `${twin.x1},${twin.y1},${twin.x2},${twin.y2}`;
          // Without R: off = the hand chain, on = it minus the run model's removals. With R: off = the run
          // model's posting (as production runs today), on = that minus R's removals too.
          const runPosts = handPosts && !removed.has(twinKey);
          const offPosts = renoShipped === null ? handPosts : runPosts;
          const modelPosts = renoShipped === null ? runPosts : runPosts && !renoRemoved.has(twinKey);
          s.off += offPosts ? extra : ok;
          s.on += modelPosts ? extra : ok;
          if (offPosts && !modelPosts) { s.removedOk += ok; s.removedJunk += extra; }
          const score = scoreOfKept.get(twinKey);
          if (modelPosts && score !== undefined && score >= line) { s.autoOk += ok; s.autoFalse += extra; }
          s.offered += r.lengthFeet;
        });
        bySet.set(dir, s);
      }
    }
    const t = { off: 0, on: 0, removedOk: 0, removedJunk: 0, autoOk: 0, autoFalse: 0, offered: 0 };
    const lines: string[] = [`${renoShipped === null ? "RUN MODEL GATE (off = hand chain, on = + run model)" : "R GATE (off = run model on, on = run model + R)"} — ${HELD ? "HELD-OUT (committed models)" : "TRAINING (LOSO folds)"}  remove below ${RUN_REMOVE_BELOW}, auto-post at ${line}`];
    lines.push(`${"set".padEnd(36)} ${"offered".padStart(8)} ${"err off".padStart(8)} ${"err on".padStart(8)} ${"pts".padStart(6)} | ${"auto ok".padStart(7)} ${"false".padStart(5)}`);
    let worse = 0;
    for (const [dir, s] of [...bySet.entries()].sort()) {
      for (const key of Object.keys(t) as (keyof typeof t)[]) t[key] += s[key];
      const pts = (100 * (s.on - s.off)) / Math.max(s.offered, 1);
      if (pts > 2 && s.on - s.off > 50) worse += 1;
      lines.push(`${dir.slice(0, 36).padEnd(36)} ${s.offered.toFixed(0).padStart(8)} ${s.off.toFixed(0).padStart(8)} ${s.on.toFixed(0).padStart(8)} ${pts.toFixed(1).padStart(6)} | ${s.autoOk.toFixed(0).padStart(7)} ${s.autoFalse.toFixed(0).padStart(5)}`);
    }
    lines.push(`TOTAL error ft (junk posted + real left off): gate OFF ${t.off.toFixed(0)}  gate ON ${t.on.toFixed(0)}  (${((100 * (t.off - t.on)) / Math.max(t.off, 1)).toFixed(1)}% better; $${((t.off - t.on) * 18).toFixed(0)} at $18/LF)`);
    lines.push(`held back by the model: ${t.removedJunk.toFixed(0)} ft junk, ${t.removedOk.toFixed(0)} ft real; sets worse by > 2 pts AND > 50 ft: ${worse}`);
    lines.push(`auto-post (posted runs at or above the line): ${t.autoOk.toFixed(0)} ft ok / ${t.autoFalse.toFixed(0)} false = ${((100 * t.autoOk) / Math.max(t.autoOk + t.autoFalse, 1)).toFixed(2)}%`);
    if (skipped.length > 0) lines.push(`run model: no LOSO fold (never trained on, committed model used): ${skipped.join(", ")}`);
    if (renoShipped !== null) lines.push(`R: scored by its own LOSO fold on ${renoFolded.length} sets (${renoFolded.join(", ")}); every other set by the committed R, which never trained on it`);
    if (parity.length > 0) lines.push(`PARITY with the exam table: ${parity.filter((p) => p.equal).length} of ${parity.length} sheets equal; unequal: ${parity.filter((p) => !p.equal).map((p) => `${p.sheet} (${p.rows} rows, max ${p.maxDiff.toExponential(1)})`).join("; ") || "none"}`);
    writeFileSync(OUT, JSON.stringify({ held: HELD, mode: renoShipped === null ? "run-model" : "reno", total: t, worse, bySet: Object.fromEntries(bySet), parity, skipped, renoFolded }, null, 1));
    console.log(lines.join("\n"));
    const measured = [...bySet.keys()];
    expect(measured.length).toBeGreaterThan(0);
    for (const must of MUST) expect(parity.find((p) => p.sheet === must), `parity sheet ${must}`).toMatchObject({ equal: true });
  });
});
