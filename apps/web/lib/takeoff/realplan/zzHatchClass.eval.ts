import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── WHAT THE in-a-hatch CLASS IS HOLDING, LINE BY LINE, ON TRAINING LABELS ──
 *
 * The one set-aside reason that hides real wall (942 ft of the held-out key,
 * read as a total). This scores every line it withholds on the training
 * sheets against the sheet's labels — real, junk or unverdicted — and buckets
 * the feet by what the line looks like: its length, how many parallel
 * neighbours it has, whether they sit on one side or both, how many of its
 * ends a found wall meets. A bucket that is mostly real wall is a rule; a
 * class that is junk in every bucket is not.
 *
 *   REAL_PLAN_DIR=… REAL_PLAN_DIR2=… TAKEOFF_LABEL_DIR=… \
 *     npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzHatchClass.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
function findPdf(dir: string): string | null {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const name of readdirSync(root)) if (name.toLowerCase().endsWith(".pdf") && flat(name) === flat(dir)) return join(root, name);
  return null;
}
type G = { x1: number; y1: number; x2: number; y2: number };
type Verdict = G & { lengthFeet: number; thicknessFeet?: number; verdict: string };
type Saved = { page: number; feetPerUnit: number; verdicts: Verdict[] };
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
type Tally = { real: number; junk: number; other: number; n: number };
const fresh = (): Tally => ({ real: 0, junk: 0, other: 0, n: 0 });
const add = (m: Map<string, Tally>, k: string, status: "real" | "junk" | "other", L: number) => { const t = m.get(k) ?? fresh(); t[status] += L; t.n += 1; m.set(k, t); };
const show = (title: string, m: Map<string, Tally>) => {
  console.log(`\n  ${title}`);
  for (const [k, t] of [...m].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`    ${k.padEnd(34)} lines ${String(t.n).padStart(4)}  real ${t.real.toFixed(0).padStart(6)}  junk ${t.junk.toFixed(0).padStart(6)}  unverdicted ${t.other.toFixed(0).padStart(6)}  real:junk ${t.junk > 0 ? (t.real / t.junk).toFixed(2) : "∞"}`);
};

describe.skipIf(DIR === "" || LABELS === "")("what the in-a-hatch class withholds, on training labels", () => {
  it("buckets every withheld foot by what the line looks like", { timeout: 7_200_000 }, async () => {
    const found: string[] = [];
    const byLen = new Map<string, Tally>(), byN = new Map<string, Tally>(), bySide = new Map<string, Tally>(), byEnds = new Map<string, Tally>(), byCombo = new Map<string, Tally>(), byBuilding = new Map<string, Tally>();
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir)) || heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(join(LABELS, dir))) {
        if (!name.endsWith(".json")) continue;
        const sheet = name.slice(0, -5);
        if (excludedSheetReason(dir, sheet) !== null) continue;
        const pdf = findPdf(dir);
        if (pdf === null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Saved;
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        await doc.close();
        found.push(`${dir}/${sheet}`);
        const W = strokes.widthPt; const fpu = saved.feetPerUnit;
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu });
        const offered = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W })), widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
        const toRun = (v: Verdict) => ({ ...v, th: v.thicknessFeet ?? 0 });
        const real = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced").map(toRun);
        const rejected = saved.verdicts.filter((v) => v.verdict === "not-wall").map(toRun);
        const walls = d.found.walls;
        for (const l of offered.setAsideLines) {
          if (l.kind !== "in-a-hatch") continue;
          const me = { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, th: 0 };
          const L = l.lengthFeet;
          const realC = coveredFeet(me, real, fpu), rej = coveredFeet(me, rejected, fpu);
          const status: "real" | "junk" | "other" = realC >= 0.5 * L ? "real" : rej >= 0.5 * L ? "junk" : "other";
          const n = Number(/^(\d+) parallel/.exec(l.why)?.[1] ?? 0);
          const side = /ONE side/.test(l.why) ? "one side" : "both sides";
          // How many of its ends a found wall reaches: a room's wall face ends at other walls; a hatch stroke ends in air.
          const near = (x: number, y: number) => walls.some((w) => Math.min(Math.hypot(w.x1 - x, w.y1 - y), Math.hypot(w.x2 - x, w.y2 - y)) * fpu <= 1.5 || (offLine(w, x, y) * fpu <= 1 && overlapAlong(w, { x1: x, y1: y, x2: x, y2: y }) >= 0));
          const ends = (near(l.x1, l.y1) ? 1 : 0) + (near(l.x2, l.y2) ? 1 : 0);
          const lenB = L < 12 ? "a <12 ft" : L < 20 ? "b 12-20 ft" : L < 40 ? "c 20-40 ft" : "d 40+ ft";
          const nB = n <= 4 ? "3-4 neighbours" : n <= 8 ? "5-8 neighbours" : "9+ neighbours";
          add(byLen, lenB, status, L); add(byN, nB, status, L); add(bySide, side, status, L); add(byEnds, `${ends} end(s) at a found wall`, status, L);
          add(byCombo, `${lenB} · ${side} · ${nB}`, status, L);
          add(byBuilding, dir.slice(0, 30), status, L);
        }
      }
    }
    show("by length", byLen); show("by neighbour count", byN); show("by which side", bySide); show("by ends meeting a found wall", byEnds); show("by building", byBuilding); show("combined", byCombo);
    expect(found.length, "no training sheet was read").toBeGreaterThan(0);
  });
});
