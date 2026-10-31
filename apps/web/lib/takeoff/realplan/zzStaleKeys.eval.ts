import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { demoRuns } from "../demoWalls";
import { drawnWithPen, legendPens, textRows, type Pen } from "../existingWalls";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { onPriorPlan, type PriorLine } from "../planCompare";
import { alignViews } from "../viewAlign";
import type { WallCandidate } from "../wallVectors";
import { longFaces, pairsForSet } from "./planPairs";

/**
 * ── ANSWER KEYS THAT MAY STILL HOLD EXISTING WALLS ──
 *
 * Crosslines A100's key accepts walls its own D100 legend calls existing. Two
 * signals, each a reason for a person to look and neither a verdict:
 *
 *   LEGEND — any sheet of the set draws an EXISTING WALL sample, and accepted
 *   key walls carry that pen. A solid-line legend matches new walls too, so
 *   this over-flags by design.
 *   DEMO PLAN — the paired demolition plan draws an accepted key wall, in the
 *   same place and thickness, as remaining.
 *
 * A sheet is listed at STALE_FEET of either. Training prints feet; held-out
 * prints sheet names and nothing else. Accepted walls only: a trace has no
 * thickness to compare.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const STALE_FEET = 50;
const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
function findPdf(dir: string): string | null {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const name of readdirSync(root)) if (name.toLowerCase().endsWith(".pdf") && flat(name) === flat(dir)) return join(root, name);
  return null;
}
type Verdict = { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet?: number; verdict: string };
type Saved = { page: number; feetPerUnit: number; verdicts: Verdict[] };

describe.skipIf(DIR === "" || LABELS === "")("answer keys that may still hold existing walls", () => {
  it("lists them for a person to re-check", { timeout: 7_200_000 }, async () => {
    const training: string[] = [];
    const held: string[] = [];
    let sheets = 0;
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir))) continue;
      const pdf = findPdf(dir);
      if (pdf === null) continue;
      const files = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json") && excludedSheetReason(dir, n.slice(0, -5)) === null);
      if (files.length === 0) continue;
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const first = JSON.parse(readFileSync(join(LABELS, dir, files[0]), "utf8")) as Saved;
      const pens: { pen: Pen; row: string }[] = [];
      for (let page = 1; page <= doc.pageCount; page += 1) {
        const text = await doc.pageText(page);
        const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        if (!/EXIST/i.test(items.map((i) => i.str).join(" "))) continue;
        const s = await doc.pageStrokes(page);
        const found = legendPens(textRows(items), s.segments.map((o) => ({ ...o, x1: o.x1 / s.widthPt, y1: o.y1 / s.widthPt, x2: o.x2 / s.widthPt, y2: o.y2 / s.widthPt })), s.widthPt).existing;
        if (found !== null) pens.push(found);
      }
      const pairs = await pairsForSet(doc, first.feetPerUnit);
      for (const file of files) {
        const sheet = file.slice(0, -5);
        const saved = JSON.parse(readFileSync(join(LABELS, dir, file), "utf8")) as Saved;
        const st = await doc.pageStrokes(saved.page);
        if (st.segments.length < 100) continue;
        sheets += 1;
        const W = st.widthPt, fpu = saved.feetPerUnit;
        const units = st.segments.map((o) => ({ ...o, x1: o.x1 / W, y1: o.y1 / W, x2: o.x2 / W, y2: o.y2 / W }));
        const key = saved.verdicts.filter((v) => v.verdict === "wall" && (v.thicknessFeet ?? 0) > 0).map((v) => v as unknown as WallCandidate);
        const keyFeet = key.reduce((n, w) => n + w.lengthFeet, 0);
        const byPen = key.filter((w) => pens.some((p) => drawnWithPen(w, p.pen, units, fpu))).reduce((n, w) => n + w.lengthFeet, 0);
        let onDemo = 0;
        let demoPage: number | null = null;
        const mine = longFaces(st.segments, W, fpu);
        for (const pair of pairs.filter((p) => p.newPage === saved.page)) {
          const o = await doc.pageStrokes(pair.demoPage);
          const t = await doc.pageText(pair.demoPage);
          const its = t.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
          const fp = (fpu * o.widthPt) / W;
          let remain: WallCandidate[];
          try {
            remain = findWallsOnSheet({ segments: o.segments, textItems: its, pageSize: { widthPt: o.widthPt, heightPt: o.heightPt }, feetPerUnit: fp, wallTypes: [], sampledSheets: null }).walls;
          } catch { continue; }
          const removed: PriorLine[] = demoRuns(o.segments, o.widthPt, fp, its).map((r) => ({ ...r, thicknessFeet: r.thicknessIn / 12 }));
          remain = remain.filter((w) => !onPriorPlan(w, removed, fpu));
          const shift = pair.shift ?? alignViews(mine, longFaces(o.segments, o.widthPt, fp), fpu);
          if (shift === null) continue;
          const moved: PriorLine[] = remain.map((w) => ({ x1: w.x1 + shift.dx, y1: w.y1 + shift.dy, x2: w.x2 + shift.dx, y2: w.y2 + shift.dy, thicknessFeet: w.thicknessFeet }));
          const feet = key.filter((w) => onPriorPlan(w, moved, fpu)).reduce((n, w) => n + w.lengthFeet, 0);
          if (feet > onDemo) { onDemo = feet; demoPage = pair.demoPage; }
        }
        if (byPen < STALE_FEET && onDemo < STALE_FEET) continue;
        if (heldOutReason(dir) !== null) held.push(`${dir.slice(0, 40)} ${sheet}`);
        else training.push(`  ${`${dir.slice(0, 26)}/${sheet}`.padEnd(36)} accepted ${keyFeet.toFixed(0).padStart(5)} ft · legend pen ${byPen.toFixed(0).padStart(5)} · on demo plan ${onDemo.toFixed(0).padStart(5)}${demoPage === null ? "" : ` (p${demoPage})`}`);
      }
      await doc.close();
    }
    console.log(`\nSTALE-KEY CANDIDATES, ${sheets} sheets read\nTRAINING\n${training.join("\n")}\nHELD-OUT, names only\n  ${held.join("\n  ")}`);
    expect(sheets, "no sheet was read").toBeGreaterThan(0);
  });
});
