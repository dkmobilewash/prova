import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Candidate } from "../answerKeyReview";
import { duplicatePairs, endEvidence } from "../duplicateCandidates";
import { inPageWidthUnits } from "../findWallsOnSheet";
import { heldOutReason } from "../heldOutSets";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── WHICH TWIN THE DUPLICATE RULE KEEPS, ON THE CANDIDATES THE REVIEWER SAW ──
 *
 * The candidates are the label file's own rows, so nothing drifts with the
 * finder: these are the lines that were offered, with the reviewer's verdict
 * on each. A pair counts only where the reviewer SPLIT the twins. Per building
 * on training; `DUPWALL_HELD=1` scores the held-out buildings, TOTALS ONLY.
 *
 *   DUPWALL_LABELS=… DUPWALL_PLANS=… DUPWALL_OUT=… npx vitest run --config vitest.eval.config.mts \
 *     lib/takeoff/realplan/zzDupWall.eval.ts
 */
const LABELS = process.env.DUPWALL_LABELS ?? "";
const PLANS = process.env.DUPWALL_PLANS ?? "";
const OUT = process.env.DUPWALL_OUT ?? "";
const HELD = process.env.DUPWALL_HELD === "1";
const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
function pdfFor(dir: string): string | undefined {
  for (const base of [PLANS, join(PLANS, "new")]) {
    if (!existsSync(base)) continue;
    const hit = readdirSync(base).find((n) => n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir));
    if (hit !== undefined) return join(base, hit);
  }
  return undefined;
}
type Row = { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number; verdict: string };

describe.skipIf(LABELS === "" || PLANS === "" || OUT === "")("the duplicate rule on the reviewed candidates", () => {
  it("keeps the twin the reviewer accepted", { timeout: 7_200_000 }, async () => {
    const lines: string[] = [];
    const tally = new Map<string, { right: number; wrong: number; pairs: number }>();
    let sheets = 0;
    for (const dir of readdirSync(LABELS).sort()) {
      if ((heldOutReason(dir) !== null) !== HELD) continue;
      // The held-out hotel set where Chrome saw the case is not used, even for totals.
      if (/EH[^a-z]*Hutto/i.test(dir)) continue;
      const pdf = pdfFor(dir);
      if (pdf === undefined) continue;
      for (const name of readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json"))) {
        const lab = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as { page: number; feetPerUnit: number; verdicts: Row[] };
        const rows = lab.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "not-wall");
        const candidates: Candidate[] = rows.map((v, i) => ({ id: String(i), x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, lengthFeet: v.lengthFeet, thicknessIn: v.thicknessFeet > 0 ? v.thicknessFeet * 12 : null, from: "pair", note: "" }));
        const read = await sheetStrokes(Buffer.from(readFileSync(pdf)), lab.page);
        const segs = read.segments.map(inPageWidthUnits(read.widthPt));
        sheets += 1;
        const t = tally.get(dir) ?? { right: 0, wrong: 0, pairs: 0 };
        for (const p of duplicatePairs(candidates, lab.feetPerUnit, segs)) {
          t.pairs += 1;
          const k = rows[Number(p.keep)]!;
          const d = rows[Number(p.drop)]!;
          if (!HELD && process.env.DUPWALL_ALL === "1" && p.apartFeet >= 0.9 && p.apartFeet <= 1.7) {
            const kc = candidates[Number(p.keep)]!;
            const dc = candidates[Number(p.drop)]!;
            if (Math.max(kc.lengthFeet, dc.lengthFeet) / Math.min(kc.lengthFeet, dc.lengthFeet) <= 1.6) {
              const f = (c: Candidate, v: string) => {
                const e = endEvidence(c, candidates.filter((o) => o !== kc && o !== dc), lab.feetPerUnit);
                return `${v} ${c.lengthFeet.toFixed(1)}ft ${(c.thicknessIn ?? 0).toFixed(1)}in ends ${e.endsMet} cont ${e.continues ? 1 : 0}`;
              };
              lines.push(`  PAIR apart ${p.apartFeet.toFixed(2)} | keep ${f(kc, k.verdict)} | drop ${f(dc, d.verdict)} | ${dir.slice(0, 18)}/${name.slice(0, -5)} | K ${kc.x1.toFixed(4)},${kc.y1.toFixed(4)},${kc.x2.toFixed(4)},${kc.y2.toFixed(4)} D ${dc.x1.toFixed(4)},${dc.y1.toFixed(4)},${dc.x2.toFixed(4)},${dc.y2.toFixed(4)}`);
            }
          }
          if (k.verdict === d.verdict) continue;
          if (!HELD && process.env.DUPWALL_FEATURES === "1" && p.apartFeet >= 0.5) {
            const kc = candidates[Number(p.keep)]!;
            const dc = candidates[Number(p.drop)]!;
            const f = (c: Candidate) => {
              const e = endEvidence(c, candidates.filter((o) => o !== kc && o !== dc), lab.feetPerUnit);
              return `${c.lengthFeet.toFixed(1)}ft ${(c.thicknessIn ?? 0).toFixed(1)}in ends ${e.endsMet} cont ${e.continues ? 1 : 0}`;
            };
            const wallIs = k.verdict === "wall" ? "KEEP" : "DROP";
            lines.push(`  FEAT wall=${wallIs} apart ${p.apartFeet.toFixed(2)} sup ${p.support ? `${p.support.keep.toFixed(2)}/${p.support.drop.toFixed(2)}` : "-"} | keep ${f(kc)} | drop ${f(dc)} | ${dir.slice(0, 18)}/${name.slice(0, -5)} | K ${kc.x1.toFixed(4)},${kc.y1.toFixed(4)},${kc.x2.toFixed(4)},${kc.y2.toFixed(4)} D ${dc.x1.toFixed(4)},${dc.y1.toFixed(4)},${dc.x2.toFixed(4)},${dc.y2.toFixed(4)}`);
          }
          if (k.verdict === "wall") t.right += 1;
          else {
            t.wrong += 1;
            if (!HELD) lines.push(`  WRONG ${dir.slice(0, 26)}/${name.slice(0, -5)} kept ${k.lengthFeet.toFixed(1)}ft ${(k.thicknessFeet * 12).toFixed(1)}in dropped WALL ${d.lengthFeet.toFixed(1)}ft ${(d.thicknessFeet * 12).toFixed(1)}in apart ${p.apartFeet.toFixed(2)} support ${p.support ? `${p.support.keep.toFixed(2)}/${p.support.drop.toFixed(2)}` : "-"} wall at ${d.x1.toFixed(4)},${d.y1.toFixed(4)} ${d.x2.toFixed(4)},${d.y2.toFixed(4)}`);
          }
        }
        tally.set(dir, t);
      }
    }
    expect(sheets, "no labelled sheet was read").toBeGreaterThan(0);
    let right = 0;
    let wrong = 0;
    for (const [dir, t] of tally) {
      right += t.right;
      wrong += t.wrong;
      if (!HELD && t.right + t.wrong > 0) lines.push(`${dir.slice(0, 40)}\tsplit pairs ${t.right + t.wrong}\tkept the wall ${t.right}\tkept the other ${t.wrong}`);
    }
    lines.push(`${HELD ? "HELD-OUT" : "TRAINING"} TOTAL: sheets ${sheets}, split pairs ${right + wrong}, kept the wall ${right}, kept the other ${wrong}`);
    writeFileSync(OUT, lines.join("\n") + "\n");
  });
});
