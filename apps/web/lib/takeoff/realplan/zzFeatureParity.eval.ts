import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { productDetection, sampledSheetsFor } from "../productDetection";
import { sheetStrokes } from "../sheetStrokes";
import { FEATURE_NAMES } from "../wallFeatures";
import type { WallCandidate } from "../wallVectors";

/**
 * ── THE PRODUCT'S FEATURES FOR A RUN MUST BE THE TRAINING SCRIPT'S, BYTE FOR BYTE (METHOD v2) ──
 *
 * A model scores what the product hands it. Trained on rows from one feature path and run on
 * another, it scores numbers it never saw. Before `productDetection.ts` the TRAINING path
 * (`zzTrainRows.eval.ts`) was `findWallsOnSheet` on the whole sheet and the PRODUCT path
 * (`detectWallsForCalibration`) was `detectForSheet` per plan view — and all 3,636 matched candidates
 * differed (2026-11-13). Both now call the shared builder; this reads the two calls as written. Same sheet, same scale (the label file's); candidates matched by geometry;
 * every matched vector compared as JSON. Reports the columns that differ and the candidates either
 * side has alone. Calls no model, writes nothing but OUT.
 *
 *     REAL_PLAN_DIR=…/real-plans/new TAKEOFF_LABEL_DIR=…/labels-snap-… [OUT=/tmp/parity.txt] \
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzFeatureParity.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
/** Three training sheets (none held out): a renovation with tags, a TI with printed codes, a small restaurant. */
const SHEETS = [
  { pdf: "2025.07.08_Baker_EOC_BID.pdf", labels: "2025.07.08_Baker_EOC_BID.pdf/A101.json" },
  { pdf: "TOTEM LAKE DENTALTENANT IMPROVEMENT.pdf", labels: "TOTEM_LAKE_DENTALTENANT_IMPROVEMENT.pdf/A2.1.json" },
  { pdf: "Falafel Fresh, Lake St, Kirkland WA.pdf", labels: "Falafel_Fresh_Lake_St_Kirkland_WA.pdf/A2.20.json" },
];
type Row = { key: string; features: readonly number[] };
// Endpoints to 1e-5 of the page width, direction-free: the same run from either path.
const keyOf = (w: Pick<WallCandidate, "x1" | "y1" | "x2" | "y2">) => {
  const a = `${w.x1.toFixed(5)},${w.y1.toFixed(5)}`, b = `${w.x2.toFixed(5)},${w.y2.toFixed(5)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

describe.skipIf(DIR === "" || LABELS === "")("feature parity: product vs training", () => {
  it("matches byte for byte on three training sheets", { timeout: 1_800_000 }, async () => {
    const out: string[] = [];
    let compared = 0, differ = 0, productOnly = 0, trainingOnly = 0;
    for (const sheet of SHEETS) {
      const saved = JSON.parse(readFileSync(join(LABELS, sheet.labels), "utf8")) as { page: number; feetPerUnit: number };
      const bytes = Buffer.from(readFileSync(join(DIR, sheet.pdf)));
      const read = await sheetStrokes(bytes, saved.page);
      if (read === null) throw new Error(`${sheet.pdf} p${saved.page}: unreadable`);
      const doc = await openPlanPdf(bytes);
      const textItems = (await doc.pageText(saved.page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const pageSize = { widthPt: read.widthPt, heightPt: read.heightPt };
      // TRAINING: exactly what `zzTrainRows.eval.ts` calls.
      const training: Row[] = [];
      const trainSampled = await sampledSheetsFor({ pageCount: doc.pageCount, pageNumber: saved.page, own: read, read: (n) => doc.pageStrokes(n) });
      productDetection({ segments: read.segments, textItems, pageSize, feetPerUnit: saved.feetPerUnit, wallTypes: [], legendCodes: null, scanned: false, sampledSheets: trainSampled }, (f, w) => training.push({ key: keyOf(w), features: [...f] }));
      // PRODUCT: what `detectWallsForCalibration` passes for a new company (no types, plan text off),
      // its template read on its own, as the product reads it.
      const product: Row[] = [];
      const productSampled = await sampledSheetsFor({ pageCount: doc.pageCount, pageNumber: saved.page, own: read, read: (n) => doc.pageStrokes(n), outOfTime: () => false });
      productDetection({ segments: read.segments, textItems, pageSize, feetPerUnit: saved.feetPerUnit, wallTypes: [], legendCodes: null, scanned: false, sampledSheets: productSampled, pairWithThicknesses: true }, (f, w) => product.push({ key: keyOf(w), features: [...f] }));
      await doc.close();
      const t = new Map(training.map((r) => [r.key, r.features]));
      const p = new Map(product.map((r) => [r.key, r.features]));
      const cols = new Map<string, number>();
      let here = 0, hereDiff = 0;
      for (const [k, pf] of p) {
        const tf = t.get(k);
        if (tf === undefined) { productOnly += 1; continue; }
        here += 1;
        if (JSON.stringify(pf) === JSON.stringify(tf)) continue;
        hereDiff += 1;
        pf.forEach((v, i) => { if (!Object.is(v, tf[i])) cols.set(FEATURE_NAMES[i] ?? `#${i}`, (cols.get(FEATURE_NAMES[i] ?? `#${i}`) ?? 0) + 1); });
      }
      const tOnly = [...t.keys()].filter((k) => !p.has(k)).length;
      trainingOnly += tOnly; compared += here; differ += hereDiff;
      const line = `PARITY ${sheet.labels}: product ${p.size} · training ${t.size} · matched ${here} · differ ${hereDiff} · product-only ${p.size - here} · training-only ${tOnly} · columns [${[...cols].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(" ")}]`;
      out.push(line);
      console.log(line);
    }
    const total = `PARITY TOTAL matched ${compared} · differ ${differ} · product-only ${productOnly} · training-only ${trainingOnly}`;
    console.log(total);
    if (process.env.OUT) writeFileSync(process.env.OUT, [total, ...out].join("\n") + "\n");
    expect(compared, "no candidate matched by geometry: the comparison measured nothing").toBeGreaterThan(0);
    expect({ differ, productOnly, trainingOnly }).toEqual({ differ: 0, productOnly: 0, trainingOnly: 0 });
  });
});
