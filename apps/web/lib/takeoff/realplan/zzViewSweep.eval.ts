import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── EVERY LABELLED SHEET THROUGH THE PRODUCT PATH, RULES ONLY ──
 *
 * One line per label file — training AND held-out, because this is the
 * collateral check for a view-detection change, not a tuning run: what it
 * prints for a held-out sheet is read only as "did this change move it".
 * Per sheet: key, proposed, missing and extra feet, how many drawings the
 * sheet was split into and which were kept. Two runs and a diff of the JSON
 * is the before/after.
 *
 *   REAL_PLAN_DIR=… REAL_PLAN_DIR2=… TAKEOFF_LABEL_DIR=… SWEEP_OUT=dir SWEEP_TAG=x \
 *     npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzViewSweep.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.SWEEP_OUT ?? "";
const TAG = process.env.SWEEP_TAG ?? "run";
/** Only sheets whose `set/sheet` contains this; and with `SWEEP_DUMP=1`, every proposed run is written per sheet, each with the feet of it the key does not cover. */
const ONLY = process.env.SWEEP_ONLY ?? "";
const DUMP = process.env.SWEEP_DUMP === "1";
const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
function findPdf(dir: string): string | null {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const name of readdirSync(root)) if (name.toLowerCase().endsWith(".pdf") && flat(name) === flat(dir)) return join(root, name);
  return null;
}
type Saved = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number };

describe.skipIf(DIR === "" || LABELS === "")("every labelled sheet, rules only", () => {
  it("scores each sheet and says how it was split", { timeout: 7_200_000 }, async () => {
    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir))) continue;
      for (const name of readdirSync(join(LABELS, dir))) if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
    }
    files.sort((a, b) => a.dir.localeCompare(b.dir) || a.sheet.localeCompare(b.sheet));
    const rows: Record<string, unknown>[] = [];
    for (const file of files) {
      if (ONLY !== "" && !`${file.dir}/${file.sheet}`.includes(ONLY)) continue;
      const pdf = findPdf(file.dir);
      if (pdf === null) { console.log(`  ${file.dir}/${file.sheet}: no pdf`); continue; }
      const saved = JSON.parse(readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8")) as Saved;
      const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
      if (strokes === null) continue;
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(saved.page);
      await doc.close();
      const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt }, feetPerUnit: saved.feetPerUnit });
      const offered = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((one) => ({ ...one, x1: one.x1 * strokes.widthPt, y1: one.y1 * strokes.widthPt, x2: one.x2 * strokes.widthPt, y2: one.y2 * strokes.widthPt })), widthPt: strokes.widthPt, feetPerUnit: saved.feetPerUnit, planBoxes: d.planBoxes, textItems });
      const { key } = keyFromLabels(saved);
      const proposed: ScoredRun[] = offered.candidates.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, lengthFeet: w.lengthFeet, thicknessFeet: w.thicknessIn === null ? undefined : w.thicknessIn / 12 }));
      const s = scoreSheet({ set: file.dir, sheet: file.sheet, key, proposed, feetPerUnit: saved.feetPerUnit });
      const row = { set: file.dir, sheet: file.sheet, key: Math.round(s.keyFeet), proposed: Math.round(s.proposedFeet), missing: Math.round(s.missingFeet), extra: Math.round(s.extraFeet), views: d.views, kept: d.kept.map((k) => k.name), others: d.others.length, leftOut: d.leftOut.map((l) => l.name) };
      rows.push(row);
      if (DUMP && OUT !== "") {
        mkdirSync(OUT, { recursive: true });
        const runs = proposed.map((r) => ({ ...r, extraFeet: Math.round(scoreSheet({ set: file.dir, sheet: file.sheet, key, proposed: [r], feetPerUnit: saved.feetPerUnit }).extraFeet) }));
        writeFileSync(join(OUT, `walls-${TAG}-${flat(file.dir).slice(0, 20)}-${file.sheet}.json`), JSON.stringify({ feetPerUnit: saved.feetPerUnit, key, runs }));
      }
      console.log(`  ${`${file.dir.slice(0, 24)}/${file.sheet}`.padEnd(32)} key ${String(row.key).padStart(5)} proposed ${String(row.proposed).padStart(5)} missing ${String(row.missing).padStart(5)} extra ${String(row.extra).padStart(5)} · views ${row.views} kept [${row.kept.join("; ")}] others ${row.others} leftOut ${row.leftOut.length}`);
    }
    expect(rows.length, "no labelled sheet was read").toBeGreaterThan(0);
    if (OUT !== "") {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `sweep-${TAG}.json`), JSON.stringify(rows, null, 1));
    }
    console.log(`\n  ${rows.length} sheets · proposed ${rows.reduce((t, r) => t + (r.proposed as number), 0)} · missing ${rows.reduce((t, r) => t + (r.missing as number), 0)} · extra ${rows.reduce((t, r) => t + (r.extra as number), 0)}`);
  });
});
