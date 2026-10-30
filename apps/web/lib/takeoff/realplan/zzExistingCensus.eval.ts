import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { faceDash, isDashPattern } from "../dashedFaces";
import { faceStrokes } from "../existingWalls";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import { hatchedRuns } from "../stageGroups";
import type { StrokeSegment, WallCandidate } from "../wallVectors";

/**
 * ── HOW A SHEET DRAWS NEW AGAINST EXISTING, WHEN IT SAYS NOTHING IN WORDS ──
 *
 * Against new-work-only keys 62% of offered footage is junk, most of it
 * existing walls on renovation sheets, and the word-reading set-aside fires
 * on no held-out sheet. So, for every OFFERED paired run on a TRAINING sheet
 * (the product path, every set-aside applied): its verdict by the labels,
 * and its STYLE — filled between the faces or outline, the fill's grey, the
 * faces' pen grey and width, dashed, hatched between the faces, the layer.
 * Then per sheet: for each binary style split, how the real and junk feet
 * fall on each side, so a convention that HOLDS WITHIN A SHEET ("this sheet
 * draws some walls filled and some outline, and the outline ones are junk")
 * shows as a split with footage on both sides and the junk on one.
 *
 * Training only; held-out is never read here. Feet, not counts.
 *
 *   EX_SHEETS="murray/A101,baker/A100"   (optional)
 *   CENSUS_DUMP=1                        every offered run with its style
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
function overlapAlong(a: G, b: G): number { const la = len(a); if (la === 0) return 0; const ux = (a.x2 - a.x1) / la, uy = (a.y2 - a.y1) / la; const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy; const b1 = at(b.x1, b.y1), b2 = at(b.x2, b.y2); return Math.max(0, Math.min(la, Math.max(b1, b2)) - Math.max(0, Math.min(b1, b2))); }
const band = (aTh: number, bTh: number, fpu: number) => Math.min(3, Math.max(1.5, Math.max(aTh, bTh) / 2 + 0.5)) / fpu;
function coveredFeet(a: G & { th: number }, others: readonly (G & { th: number })[], fpu: number): number {
  let covered = 0;
  for (const o of others) { if (!parallel(a, o)) continue; if (Math.max(offLine(a, o.x1, o.y1), offLine(a, o.x2, o.y2)) > band(a.th, o.th, fpu)) continue; covered += overlapAlong(a, o); }
  return Math.min(len(a), covered) * fpu;
}
const median = (xs: number[]) => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]);

type Style = {
  filled: boolean;
  fillGray: number | null;
  gray: number;
  width: number;
  dashed: boolean;
  hatched: boolean;
  layer: string | null;
  /** A layer whose name says existing or demolition. */
  layerExisting: boolean;
};
const LAYER_EXISTING = /EXIST|\bEXST\b|\bEXG\b|DEMO|\bNIC\b|-E$|-E-|_E$|\bE-WALL/i;

function styleOf(w: WallCandidate, units: readonly StrokeSegment[], fpu: number, hatched: Set<WallCandidate>): Style {
  const faces = [...faceStrokes(w, 1, units, fpu), ...faceStrokes(w, -1, units, fpu)];
  const byLen = (f: (s: StrokeSegment) => number | undefined) => { const xs: number[] = []; for (const s of faces) { const v = f(s); if (v !== undefined) for (let i = 0; i < Math.max(1, Math.round(len(s) * fpu)); i += 1) xs.push(v); } return xs; };
  const fills = byLen((s) => s.fill);
  const layers = new Map<string, number>();
  for (const s of faces) if (s.layer !== undefined) layers.set(s.layer, (layers.get(s.layer) ?? 0) + len(s));
  const layer = [...layers].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const faceLen = faces.reduce((n, s) => n + len(s), 0);
  const filledLen = faces.filter((s) => s.fill !== undefined).reduce((n, s) => n + len(s), 0);
  return {
    filled: faceLen > 0 && filledLen >= 0.4 * faceLen,
    fillGray: fills.length === 0 ? null : median(fills),
    gray: median(byLen((s) => s.gray ?? 0)),
    width: median(byLen((s) => s.width ?? 0)),
    dashed: isDashPattern(faceDash(w, 1, units, fpu)) || isDashPattern(faceDash(w, -1, units, fpu)),
    hatched: hatched.has(w),
    layer,
    layerExisting: layer !== null && LAYER_EXISTING.test(layer),
  };
}

type Side = { real: number; junk: number; other: number };
const side = (): Side => ({ real: 0, junk: 0, other: 0 });
type Split = { name: string; a: string; b: string; of: (s: Style, sheet: SheetStats) => "a" | "b" | null };
type SheetStats = { medianWidth: number; medianGray: number };
const SPLITS: Split[] = [
  { name: "fill", a: "filled", b: "outline", of: (s) => (s.filled ? "a" : "b") },
  { name: "grey", a: "grey pen (≥0.3)", b: "black pen", of: (s) => (s.gray >= 0.3 ? "a" : "b") },
  { name: "fill-grey", a: "grey fill (≥0.3)", b: "white/none", of: (s) => (s.fillGray !== null && s.fillGray >= 0.3 ? "a" : "b") },
  { name: "pen", a: "thin (<0.7× sheet median)", b: "usual/heavy", of: (s, sh) => (sh.medianWidth > 0 ? (s.width < 0.7 * sh.medianWidth ? "a" : "b") : null) },
  { name: "heavy", a: "heavy (>1.5× sheet median)", b: "usual/thin", of: (s, sh) => (sh.medianWidth > 0 ? (s.width > 1.5 * sh.medianWidth ? "a" : "b") : null) },
  { name: "dashed", a: "a face dashed", b: "solid", of: (s) => (s.dashed ? "a" : "b") },
  { name: "hatch", a: "hatched between", b: "plain", of: (s) => (s.hatched ? "a" : "b") },
  { name: "layer", a: "existing/demo layer", b: "other layer", of: (s) => (s.layer === null ? null : s.layerExisting ? "a" : "b") },
];

describe.skipIf(DIR === "" || LABELS === "")("how training sheets draw existing against new", () => {
  it("tallies offered junk and real by drawing style, per sheet and per convention", { timeout: 7_200_000 }, async () => {
    const found: string[] = [];
    let offeredFeet = 0, junkFeet = 0, realFeet = 0, otherFeet = 0;
    const perSheet: { name: string; offered: number; junk: number; real: number; splits: Record<string, { a: Side; b: Side }> }[] = [];
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
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu });
        const units = d.found.inUnits;
        const offered = offeredCandidates({ walls: d.found.walls, segments: units.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
        const toRun = (v: Verdict) => ({ ...v, th: v.thicknessFeet ?? 0 });
        const real = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced").map(toRun);
        const rejected = saved.verdicts.filter((v) => v.verdict === "not-wall").map(toRun);
        const hatched = hatchedRuns(offered.offeredRuns, units, fpu);
        const styled = offered.offeredRuns.map((w) => {
          const me = { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, th: w.thicknessFeet };
          const L = w.lengthFeet;
          const realC = coveredFeet(me, real, fpu), rej = coveredFeet(me, rejected, fpu);
          const st: keyof Side = realC >= 0.5 * L ? "real" : rej >= 0.5 * L ? "junk" : "other";
          return { w, L, st, style: styleOf(w, units, fpu, hatched) };
        });
        const sheetStats: SheetStats = { medianWidth: median(styled.flatMap((s) => Array.from({ length: Math.max(1, Math.round(s.L)) }, () => s.style.width))), medianGray: median(styled.map((s) => s.style.gray)) };
        const row = { name: `${dir.slice(0, 22)}/${sheet}`, offered: 0, junk: 0, real: 0, splits: Object.fromEntries(SPLITS.map((s) => [s.name, { a: side(), b: side() }])) as Record<string, { a: Side; b: Side }> };
        for (const s of styled) {
          row.offered += s.L; if (s.st === "junk") row.junk += s.L; if (s.st === "real") row.real += s.L;
          for (const sp of SPLITS) { const which = sp.of(s.style, sheetStats); if (which !== null) row.splits[sp.name][which][s.st] += s.L; }
          if (process.env.CENSUS_DUMP === "1") console.log(`    RUN ${dir.slice(0, 12)}/${sheet} ${s.st} ${s.L.toFixed(0)}ft fill ${s.style.filled ? (s.style.fillGray ?? 0).toFixed(2) : "-"} gray ${s.style.gray.toFixed(2)} w ${s.style.width.toFixed(2)}${s.style.dashed ? " dashed" : ""}${s.style.hatched ? " hatched" : ""} layer ${s.style.layer ?? "-"} at ${s.w.x1.toFixed(4)},${s.w.y1.toFixed(4)}`);
        }
        offeredFeet += row.offered; junkFeet += row.junk; realFeet += row.real; otherFeet += row.offered - row.junk - row.real;
        perSheet.push(row);
      }
    }
    console.log(`\n  TRAINING offered ${offeredFeet.toFixed(0)} ft: junk ${junkFeet.toFixed(0)} (${(100 * junkFeet / Math.max(1, offeredFeet)).toFixed(0)}%), real ${realFeet.toFixed(0)}, unverdicted ${otherFeet.toFixed(0)}`);
    // Per sheet: the splits where BOTH sides carry footage (≥15% of the sheet's offered) and the junk sits on one side (≥80% of that side is junk).
    console.log("\n  PER SHEET — splits that hold (both sides ≥15% of offered; one side ≥80% junk):");
    const holds = new Map<string, { sheets: number; junkRemoved: number; realCost: number; names: string[] }>();
    for (const row of perSheet.sort((a, b) => b.junk - a.junk)) {
      const notes: string[] = [];
      for (const sp of SPLITS) {
        const { a, b } = row.splits[sp.name];
        const fa = a.real + a.junk + a.other, fb = b.real + b.junk + b.other;
        if (fa < 0.15 * row.offered || fb < 0.15 * row.offered) continue;
        for (const [label, s, desc] of [["a", a, sp.a], ["b", b, sp.b]] as const) {
          const total = s.real + s.junk + s.other;
          if (total > 0 && s.junk >= 0.8 * total) {
            notes.push(`${sp.name}: ${desc} = junk (${s.junk.toFixed(0)} junk / ${s.real.toFixed(0)} real; other side ${label === "a" ? b.junk.toFixed(0) : a.junk.toFixed(0)} junk / ${label === "a" ? b.real.toFixed(0) : a.real.toFixed(0)} real)`);
            const h = holds.get(`${sp.name}: ${desc}`) ?? { sheets: 0, junkRemoved: 0, realCost: 0, names: [] };
            h.sheets += 1; h.junkRemoved += s.junk; h.realCost += s.real; h.names.push(row.name); holds.set(`${sp.name}: ${desc}`, h);
          }
        }
      }
      console.log(`    ${row.name.padEnd(32)} offered ${row.offered.toFixed(0).padStart(6)} junk ${row.junk.toFixed(0).padStart(6)} real ${row.real.toFixed(0).padStart(6)}${notes.length === 0 ? "   (no split holds)" : ""}`);
      for (const n of notes) console.log(`        ${n}`);
      // And the raw split table for the junkiest sheets, so a convention nobody guessed shows up.
      if (row.junk >= 300) for (const sp of SPLITS) { const { a, b } = row.splits[sp.name]; if (a.real + a.junk + b.real + b.junk > 0) console.log(`        · ${sp.name.padEnd(9)} ${sp.a}: real ${a.real.toFixed(0)} junk ${a.junk.toFixed(0)} | ${sp.b}: real ${b.real.toFixed(0)} junk ${b.junk.toFixed(0)}`); }
    }
    console.log("\n  PER CONVENTION (sheets where it holds, junk it would remove, real it would cost):");
    for (const [k, h] of [...holds].sort((a, b) => b[1].junkRemoved - a[1].junkRemoved)) console.log(`    ${k.padEnd(44)} sheets ${String(h.sheets).padStart(2)}  junk ${h.junkRemoved.toFixed(0).padStart(6)}  real ${h.realCost.toFixed(0).padStart(5)}   ${h.names.join(", ")}`);
    expect(found.length, "no training sheet was read").toBeGreaterThan(0);
  });
});
