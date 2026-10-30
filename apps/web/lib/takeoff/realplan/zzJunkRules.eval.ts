import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import type { StrokeSegment, WallCandidate } from "../wallVectors";

/**
 * ── PRICING THE NEXT JUNK RULES ON EVERY OFFERED RUN, NOT ONLY THE JUNK ──
 *
 * `zzJunkKinds` sorts the CONFIRMED JUNK into kinds; a rule is priced on
 * what it would also take from the real walls. So for every offered paired
 * run on a training sheet (product path, every set-aside applied) this
 * computes the features behind the two biggest catchable kinds on the
 * cleaned keys — grid lines (1,124 ft) and stacked dimension strings
 * (2,447 ft) — and prices candidate rules per building under the shipping
 * rule: junk removed per foot of real lost ≥ 3, no building worse by more
 * than ~100 ft.
 *
 *   EX_SHEETS="sw-grand/A110,baker/A100"   (optional)
 *   JR_DUMP=1                               every offered run with its features
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const ONLY = (process.env.EX_SHEETS ?? "").split(",").filter((s) => s !== "");
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
function alongT(a: G, px: number, py: number): number { const l = len(a); if (l === 0) return 0; return ((px - a.x1) * (a.x2 - a.x1) + (py - a.y1) * (a.y2 - a.y1)) / l; }
function overlapAlong(a: G, b: G): number { const la = len(a); if (la === 0) return 0; const ux = (a.x2 - a.x1) / la, uy = (a.y2 - a.y1) / la; const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy; const b1 = at(b.x1, b.y1), b2 = at(b.x2, b.y2); return Math.max(0, Math.min(la, Math.max(b1, b2)) - Math.max(0, Math.min(b1, b2))); }
const band = (aTh: number, bTh: number, fpu: number) => Math.min(3, Math.max(1.5, Math.max(aTh, bTh) / 2 + 0.5)) / fpu;
function coveredFeet(a: G & { th: number }, others: readonly (G & { th: number })[], fpu: number): number {
  let covered = 0;
  for (const o of others) { if (!parallel(a, o)) continue; if (Math.max(offLine(a, o.x1, o.y1), offLine(a, o.x2, o.y2)) > band(a.th, o.th, fpu)) continue; covered += overlapAlong(a, o); }
  return Math.min(len(a), covered) * fpu;
}
const DIMENSION = /^[\d'"\-\s./±+]+$/;

type Feat = {
  L: number; thIn: number; axis: boolean;
  /** How far each end of the run reaches beyond the extent of every OTHER offered run along its own axis, in feet (negative = inside). */
  overA: number; overB: number;
  /** Share of the other runs' extent along this axis that this run spans. */
  spanShare: number;
  /** Other offered runs with an end within 1.5 ft of this run's line, or crossing it. */
  meets: number;
  /** Dimension-shaped words (feet-inches) with their centre BETWEEN the faces, and within 2.5 ft of a face. */
  dimBetween: number; dimNear: number;
  /** Short strokes perpendicular to the run crossing its band, per 10 ft — a dimension string's ticks and witness lines. */
  ticksPer10: number;
};
type Run = { w: WallCandidate; st: "real" | "junk" | "other"; f: Feat };

function features(c: WallCandidate, all: readonly WallCandidate[], units: readonly StrokeSegment[], words: readonly { str: string; x: number; y: number }[], fpu: number): Feat {
  const L = c.lengthFeet;
  const l = len(c);
  const horizontal = Math.abs(c.y2 - c.y1) < l * 0.02, vertical = Math.abs(c.x2 - c.x1) < l * 0.02;
  const axis = horizontal || vertical;
  const others = all.filter((o) => o !== c);
  // extent of the other runs along this run's axis
  let lo = Infinity, hi = -Infinity;
  for (const o of others) { const a = alongT(c, o.x1, o.y1), b = alongT(c, o.x2, o.y2); lo = Math.min(lo, a, b); hi = Math.max(hi, a, b); }
  const overA = others.length === 0 ? 0 : (0 - lo) * fpu; // run starts at t=0
  const overB = others.length === 0 ? 0 : (l - hi) * fpu;
  const spanShare = others.length === 0 || hi <= lo ? 0 : l / (hi - lo);
  const th = c.thicknessFeet;
  let meets = 0;
  for (const o of others) {
    const ends = [[o.x1, o.y1], [o.x2, o.y2]] as const;
    const near = ends.some(([x, y]) => offLine(c, x, y) * fpu <= 1.5 + th / 2 && alongT(c, x, y) >= -1.5 / fpu && alongT(c, x, y) <= l + 1.5 / fpu);
    if (near) { meets += 1; continue; }
    // crossing: the two ends on opposite sides, within the run's length
    const s1 = (c.x2 - c.x1) * (o.y1 - c.y1) - (c.y2 - c.y1) * (o.x1 - c.x1);
    const s2 = (c.x2 - c.x1) * (o.y2 - c.y1) - (c.y2 - c.y1) * (o.x2 - c.x1);
    if (s1 * s2 < 0) { const t = alongT(c, (o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2); if (t >= 0 && t <= l) meets += 1; }
  }
  let dimBetween = 0, dimNear = 0;
  for (const w of words) {
    if (!(DIMENSION.test(w.str) && /\d/.test(w.str))) continue;
    const t = alongT(c, w.x, w.y);
    if (t < -0.5 / fpu || t > l + 0.5 / fpu) continue;
    const off = offLine(c, w.x, w.y) * fpu;
    if (off <= th / 2 + 0.4) dimBetween += 1;
    else if (off <= th / 2 + 2.5) dimNear += 1;
  }
  let ticks = 0;
  const ux = (c.x2 - c.x1) / l, uy = (c.y2 - c.y1) / l;
  for (const s of units) {
    const sl = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (sl === 0 || sl * fpu > 3) continue;
    const cosv = Math.abs(((s.x2 - s.x1) * ux + (s.y2 - s.y1) * uy) / sl);
    if (cosv > 0.17) continue; // within ~10° of perpendicular
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    const t = alongT(c, mx, my);
    if (t < 0 || t > l) continue;
    if (offLine(c, mx, my) * fpu <= th / 2 + 0.3) ticks += 1;
  }
  return { L, thIn: th * 12, axis, overA, overB, spanShare, meets, dimBetween, dimNear, ticksPer10: L > 0 ? (10 * ticks) / L : 0 };
}

type Rule = { name: string; fires: (f: Feat) => boolean };
const RULES: Rule[] = [
  { name: "G-old: axis, spans ≥85% of the others, ≤1 meets", fires: (f) => f.axis && f.spanShare >= 0.85 && f.meets <= 1 },
  { name: "G1: axis, both ends ≥2 ft beyond every other run, ≤1 meets", fires: (f) => f.axis && Math.min(f.overA, f.overB) >= 2 && f.meets <= 1 },
  { name: "G2: axis, both ends ≥5 ft beyond every other run", fires: (f) => f.axis && Math.min(f.overA, f.overB) >= 5 },
  { name: "G3: axis, one end ≥5 ft beyond, other ≥0, ≤1 meets", fires: (f) => f.axis && Math.max(f.overA, f.overB) >= 5 && Math.min(f.overA, f.overB) >= 0 && f.meets <= 1 },
  { name: "G4: axis, both ends ≥2 ft beyond, nothing meets", fires: (f) => f.axis && Math.min(f.overA, f.overB) >= 2 && f.meets === 0 },
  { name: "D-old: dimension text between the faces", fires: (f) => f.dimBetween >= 1 },
  { name: "D1: text between, ticks ≥1 per 10 ft", fires: (f) => f.dimBetween >= 1 && f.ticksPer10 >= 1 },
  { name: "D2: text between, nothing meets", fires: (f) => f.dimBetween >= 1 && f.meets === 0 },
  { name: "D3: text between, ticks ≥1/10ft, ≤1 meets", fires: (f) => f.dimBetween >= 1 && f.ticksPer10 >= 1 && f.meets <= 1 },
  { name: "D4: ≥2 texts between", fires: (f) => f.dimBetween >= 2 },
  { name: "D5: ≥2 texts between, ≤1 meets", fires: (f) => f.dimBetween >= 2 && f.meets <= 1 },
  { name: "D6: text between or ≥2 near, ticks ≥2/10ft, ≤1 meets", fires: (f) => (f.dimBetween >= 1 || f.dimNear >= 2) && f.ticksPer10 >= 2 && f.meets <= 1 },
  { name: "T1: ticks ≥3 per 10 ft, ≤1 meets (no text needed)", fires: (f) => f.ticksPer10 >= 3 && f.meets <= 1 },
  { name: "U1 = D3 ∪ D5: a dimension string (≥2 texts between, or ≥1 with ticks ≥1/10ft), ≤1 meets", fires: (f) => (f.dimBetween >= 2 || (f.dimBetween >= 1 && f.ticksPer10 >= 1)) && f.meets <= 1 },
  { name: "U2 = U1 ∪ G-old", fires: (f) => ((f.dimBetween >= 2 || (f.dimBetween >= 1 && f.ticksPer10 >= 1)) && f.meets <= 1) || (f.axis && f.spanShare >= 0.85 && f.meets <= 1) },
  { name: "U3 = U1 with meets == 0 ∪ G-old", fires: (f) => ((f.dimBetween >= 2 || (f.dimBetween >= 1 && f.ticksPer10 >= 1)) && f.meets === 0) || (f.axis && f.spanShare >= 0.85 && f.meets <= 1) },
];

describe.skipIf(DIR === "" || LABELS === "")("pricing the next junk rules on every offered run", () => {
  it("tallies each candidate rule's junk and real per building", { timeout: 7_200_000 }, async () => {
    const found: string[] = [];
    const runs: (Run & { set: string; sheet: string })[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir)) || heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(join(LABELS, dir))) {
        if (!name.endsWith(".json")) continue;
        const sheet = name.slice(0, -5);
        if (excludedSheetReason(dir, sheet) !== null) continue;
        if (ONLY.length > 0 && !ONLY.some((o) => { const [d, sh] = o.split("/"); return dir.toLowerCase().includes(d) && sh === sheet; })) continue;
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
        const words = textItems.map((i) => ({ str: i.str.trim(), x: (i.x + i.width / 2) / W, y: (i.y - i.height / 2) / W })).filter((w) => w.str !== "");
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu });
        const units = d.found.inUnits;
        const offered = offeredCandidates({ walls: d.found.walls, segments: units.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
        const toRun = (v: Verdict) => ({ ...v, th: v.thicknessFeet ?? 0 });
        const real = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced").map(toRun);
        const rejected = saved.verdicts.filter((v) => v.verdict === "not-wall").map(toRun);
        for (const w of offered.offeredRuns) {
          const me = { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, th: w.thicknessFeet };
          const L = w.lengthFeet;
          const realC = coveredFeet(me, real, fpu), rej = coveredFeet(me, rejected, fpu);
          const st: Run["st"] = realC >= 0.5 * L ? "real" : rej >= 0.5 * L ? "junk" : "other";
          const f = features(w, offered.offeredRuns, units, words, fpu);
          runs.push({ w, st, f, set: dir, sheet });
          if (process.env.JR_DUMP === "1") console.log(`    RUN ${dir.slice(0, 12)}/${sheet} ${st} ${L.toFixed(0)}ft th ${f.thIn.toFixed(1)} axis ${f.axis ? 1 : 0} over ${f.overA.toFixed(0)}/${f.overB.toFixed(0)} span ${f.spanShare.toFixed(2)} meets ${f.meets} dim ${f.dimBetween}/${f.dimNear} ticks ${f.ticksPer10.toFixed(1)} at ${w.x1.toFixed(4)},${w.y1.toFixed(4)}`);
        }
      }
    }
    const junkAll = runs.filter((r) => r.st === "junk").reduce((n, r) => n + r.f.L, 0);
    const realAll = runs.filter((r) => r.st === "real").reduce((n, r) => n + r.f.L, 0);
    console.log(`\n  TRAINING offered ${runs.reduce((n, r) => n + r.f.L, 0).toFixed(0)} ft: junk ${junkAll.toFixed(0)}, real ${realAll.toFixed(0)}`);
    for (const rule of RULES) {
      const per = new Map<string, { junk: number; real: number }>();
      for (const r of runs) {
        if (!rule.fires(r.f)) continue;
        const p = per.get(r.set) ?? { junk: 0, real: 0 };
        if (r.st === "junk") p.junk += r.f.L; else if (r.st === "real") p.real += r.f.L;
        per.set(r.set, p);
      }
      const J = [...per.values()].reduce((n, p) => n + p.junk, 0), R = [...per.values()].reduce((n, p) => n + p.real, 0);
      const bad = [...per].filter(([, p]) => p.real > 100 || (p.real > 0 && p.junk < 3 * p.real));
      console.log(`\n  ${rule.name}: junk ${J.toFixed(0)} · real ${R.toFixed(0)} · ratio ${R > 0 ? (J / R).toFixed(1) : "∞"} · buildings failing ${bad.length}`);
      for (const [set, p] of [...per].sort((a, b) => b[1].junk + b[1].real - a[1].junk - a[1].real).slice(0, 8)) console.log(`      ${set.slice(0, 26).padEnd(26)} junk ${p.junk.toFixed(0).padStart(5)} real ${p.real.toFixed(0).padStart(5)}${bad.some(([s]) => s === set) ? "  FAIL" : ""}`);
    }
    expect(found.length, "no training sheet was read").toBeGreaterThan(0);
  });
});
