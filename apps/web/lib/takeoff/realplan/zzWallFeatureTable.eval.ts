import { Buffer } from "node:buffer";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pageInventoryWork, type SheetProposalRow } from "../../plan-ingest/pageInventory";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import type { ScoredPairing } from "../demotedRuns";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { offeredCandidates } from "../offeredCandidates";
import { productDetection, sampledSheetsFor } from "../productDetection";
import { priorPlanFor } from "../priorPlan";
import { autoPairs } from "../priorPlanLoad";
import { sheetStrokes } from "../sheetStrokes";
import { loadWallModel } from "../wallModelFile";
import { RUN_FEATURE_NAMES, RUN_FEATURES_VERSION } from "../wallRunFeatures";
import { priorForRuns, runModelRows } from "../wallRunModel";

/**
 * ── THE FEATURE TABLE: ONE ROW PER RUN ON OFFER, ON EVERY LABELLED SHEET ──
 *
 * What the learned wall scorers train on (METHOD v2). Every run the app offers
 * before the demolition-plan compare, with `runFeatureRows`' columns and its
 * label from the answer key: `extraFeet` is the part of the run the key does
 * not draw, `junk` when that is half the run or more. Keys draw NEW walls
 * only, so on a renovation sheet "junk" holds existing walls and non-walls
 * together; the keys do not tell them apart.
 *
 * Detection is the product's (`productDetection`, #1169), so the rows are parity rows.
 * Zero-touch pairing only (`autoPairs`, nothing a person accepts).
 * `WFT_HELD=1` writes the held-out sets — the final exam, run once per release.
 * Run: scripts/wall-model/table.sh <0|1> <out.jsonl>
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.WFT_OUT ?? "";
const HELD = process.env.WFT_HELD === "1";
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

describe.skipIf(DIR === "" || LABELS === "" || OUT === "" || process.env.TAKEOFF_WALL_MODEL === undefined)("wall feature table", () => {
  it("writes one row per run on offer", { timeout: 7_200_000 }, async () => {
    const config = loadWallModel();
    if (config === null) throw new Error("no wall model");
    appendFileSync(OUT, JSON.stringify({ header: true, version: RUN_FEATURES_VERSION, names: RUN_FEATURE_NAMES }) + "\n");
    let rows = 0;
    const seen: string[] = [];
    for (const dir of readdirSync(LABELS).sort()) {
      if (process.env.WFT_ONLY !== undefined && !dir.includes(process.env.WFT_ONLY)) continue;
      seen.push(dir);
      if ((heldOutReason(dir) !== null) !== HELD) continue;
      let names: string[] = [];
      try { names = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")); } catch { continue; }
      const pdf = findPdf(dir);
      if (pdf === null || names.length === 0) continue;
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
        const pairings: ScoredPairing[] = [];
        // THE PRODUCT'S OWN DETECTION (#1169, `productDetection.ts`): the set's template and the sheet's
        // tag vocabulary, as `zzTrainRows` and the product read it. A new company: no types, no legend.
        const sampledSheets = await sampledSheetsFor({ pageCount: doc.pageCount, pageNumber: saved.page, own: strokes, read: (p) => doc.pageStrokes(p) });
        const d = productDetection(
          { segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, wallTypes: [], legendCodes: null, scanned: false, sampledSheets },
          (f, w) => { pairings.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet, features: [...f] }); },
        );
        const base = { walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems };
        const off = offeredCandidates(base).offeredRuns;
        let kept = off;
        let prior: ReturnType<typeof priorForRuns>;
        const pair = auto.get(saved.page);
        if (pair !== undefined) {
          const ds = await doc.pageStrokes(pair.demoPage);
          const dt = (await doc.pageText(pair.demoPage)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
          const pp = priorPlanFor({ demo: { segments: ds.segments, textItems: dt, widthPt: ds.widthPt, heightPt: ds.heightPt }, newPage: { segments: strokes.segments, widthPt: W }, newRuns: off, feetPerUnit: fpu });
          if (pp.lines !== null) kept = offeredCandidates({ ...base, priorPlan: { lines: pp.lines, sheet: `p${pair.demoPage}` } }).offeredRuns;
          prior = priorForRuns(pp, ds, fpu, W);
        }
        await doc.close();
        // THE PRODUCT'S OWN COLUMNS (`wallRunModel.ts`): Run takeoff scores with this same call.
        const x = runModelRows({ offered: off, kept, pairings, pairModel: config.model, segments: strokes.segments, textItems, widthPt: W, feetPerUnit: fpu, ...(prior === undefined ? {} : { prior }) }).rows;
        off.forEach((r, i) => {
          const extra = scoreSheet({ set: dir, sheet, key, proposed: [{ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, thicknessFeet: r.thicknessFeet } as ScoredRun], feetPerUnit: fpu }).extraFeet;
          appendFileSync(OUT, JSON.stringify({ set: dir, sheet, ft: +r.lengthFeet.toFixed(2), extraFeet: +extra.toFixed(2), junk: extra >= 0.5 * r.lengthFeet ? 1 : 0, x: x[i]!.map((v) => +v.toFixed(4)) }) + "\n");
          rows += 1;
        });
        // The key's total, so recall can be read against every key wall, not only the ones on offer.
        const keyFeet = key.reduce((n, w) => n + w.lengthFeet, 0);
        appendFileSync(OUT, JSON.stringify({ set: dir, sheet, sheetKeyFeet: +keyFeet.toFixed(2) }) + "\n");
      }
    }
    // The label folder resolved: a mistyped TAKEOFF_LABEL_DIR or WFT_ONLY must not read as a set with no runs.
    expect(seen.length).toBeGreaterThan(0);
  });
});
