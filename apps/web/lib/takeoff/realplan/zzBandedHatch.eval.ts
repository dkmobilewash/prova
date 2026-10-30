import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── IS THE HATCH AROUND A WITHHELD LINE A BAND, OR A FIELD? ──
 *
 * The hypothesis: a wall drawn filled (masonry, a rated assembly) has its
 * hatch CONFINED to the band between its two faces — 3 to 16 in — and nothing
 * like it just beyond the far face or across the near one; a floor or site
 * pattern spreads. For every line the in-a-hatch class withholds on a
 * training sheet, this finds the farthest long parallel partner within 16 in
 * on each side, counts the strokes inside that band, beyond it and across the
 * line, scores the line against the labels, and tallies feet by that shape.
 *
 *   REAL_PLAN_DIR=… REAL_PLAN_DIR2=… TAKEOFF_LABEL_DIR=… \
 *     npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzBandedHatch.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
/** BAND_HELD_OUT=1: the held-out buildings, shape totals ONLY — no per-building line, no dump. */
const HELD = process.env.BAND_HELD_OUT === "1";
/** BAND_MAX_IN: how far out a partner may sit, inches; 16 by default, 30 to ask about masonry. */
const BAND_MAX = Number(process.env.BAND_MAX_IN ?? "16") / 12;
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
  for (const [k, t] of [...m].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`    ${k.padEnd(60)} lines ${String(t.n).padStart(4)}  real ${t.real.toFixed(0).padStart(6)}  junk ${t.junk.toFixed(0).padStart(6)}  unverdicted ${t.other.toFixed(0).padStart(6)}  real:junk ${t.junk > 0 ? (t.real / t.junk).toFixed(2) : "∞"}`);
};

/** The shape of the hatch around a line, on its better side. */
export function bandShape(line: G, strokes: readonly StrokeSegment[], fpu: number) {
  const L = len(line); const ux = (line.x2 - line.x1) / L, uy = (line.y2 - line.y1) / L;
  const signedOff = (x: number, y: number) => ((x - line.x1) * -uy + (y - line.y1) * ux) * fpu; // feet, signed
  const along = (x: number, y: number) => ((x - line.x1) * ux + (y - line.y1) * uy) / L; // 0..1 along the line
  const inSpan = (s: G) => { const a = along((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2); return a >= -0.02 && a <= 1.02; };
  const best = { side: 0, partnerFt: 0, inside: 0, beyond: 0, across: 0 };
  for (const side of [1, -1] as const) {
    // the farthest long parallel partner within 16 in on this side
    let partner = 0;
    for (const s of strokes) {
      if (!parallel(line, s) || overlapAlong(line, s) < 0.5 * L) continue;
      const d = side * signedOff((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
      if (d >= 0.25 && d <= BAND_MAX && d > partner) partner = d;
    }
    if (partner === 0) continue;
    let inside = 0, beyond = 0, across = 0;
    for (const s of strokes) {
      if (!inSpan(s) || parallel(line, s)) continue;
      const d = side * signedOff((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
      if (d > 0.04 && d < partner - 0.04) inside += 1;
      else if (d > partner + 0.04 && d <= partner + Math.max(partner, 0.5)) beyond += 1;
      else if (d < -0.04 && d >= -Math.max(partner, 0.5)) across += 1;
    }
    if (inside > best.inside) Object.assign(best, { side, partnerFt: partner, inside, beyond, across });
  }
  return best;
}

describe.skipIf(DIR === "" || LABELS === "")("the hatch around a withheld line: band or field", () => {
  it("tallies withheld feet by the shape of their hatch", { timeout: 7_200_000 }, async () => {
    const found: string[] = [];
    const byShape = new Map<string, Tally>(), byBuilding = new Map<string, Tally>();
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir)) || (heldOutReason(dir) !== null) !== HELD) continue;
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
        const units = d.found.inUnits;
        for (const l of offered.setAsideLines) {
          if (l.kind !== "in-a-hatch") continue;
          const me = { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, th: 0 };
          const L = l.lengthFeet;
          const realC = coveredFeet(me, real, fpu), rej = coveredFeet(me, rejected, fpu);
          const status: "real" | "junk" | "other" = realC >= 0.5 * L ? "real" : rej >= 0.5 * L ? "junk" : "other";
          const b = bandShape(me, units, fpu);
          const perFt = b.inside / L;
          // Why there is no partner: one further out, a fragmented one, or nothing parallel at all.
          const farthest = (lo: number, hi: number, share: number) => units.some((u) => parallel(me, u) && overlapAlong(me, u) >= share * len(me) && (() => { const ux = (me.x2 - me.x1) / len(me), uy = (me.y2 - me.y1) / len(me); const d = Math.abs(((u.x1 + u.x2) / 2 - me.x1) * -uy + ((u.y1 + u.y2) / 2 - me.y1) * ux) * fpu; return d >= lo && d <= hi; })());
          const noPartnerWhy = farthest(16 / 12, 30 / 12, 0.5) ? "a1 no partner within 16 in, but a long one at 16-30 in" : farthest(3 / 12, 16 / 12, 0.2) ? "a2 no partner within 16 in, only fragments (20-50% overlap)" : "a3 nothing parallel within 30 in";
          const shape =
            b.side === 0 ? noPartnerWhy
            : b.inside < 3 ? "b partner, under 3 strokes inside the band"
            : b.beyond <= b.inside * 0.25 && b.across <= b.inside * 0.25 ? `c FILLED BAND, confined (${(b.partnerFt * 12) < 6 ? "<6in" : (b.partnerFt * 12) < 10 ? "6-10in" : (b.partnerFt * 12) <= 16 ? "10-16in" : "16-30in"}, ${perFt >= 1 ? "dense" : "sparse"})`
            : b.beyond > b.inside * 0.25 && b.across > b.inside * 0.25 ? `e filled band, hatch on both sides too (a field) (${(b.partnerFt * 12) <= 16 ? "<=16in" : "16-30in"})`
            : `d filled band, hatch continues on one side (${(b.partnerFt * 12) <= 16 ? "<=16in" : "16-30in"})`;
          add(byShape, shape, status, L);
          if (!HELD && process.env.BAND_DUMP === "1" && /^[cd]/.test(shape)) console.log(`    DUMP ${dir.slice(0, 20)}/${sheet} p${saved.page} ${status} ${L.toFixed(0)}ft ${(b.partnerFt * 12).toFixed(1)}in inside ${b.inside} beyond ${b.beyond} across ${b.across} at ${l.x1.toFixed(4)},${l.y1.toFixed(4)} -> ${l.x2.toFixed(4)},${l.y2.toFixed(4)} · ${shape.slice(0, 1)}`);
          // Per building: on training every confined band; on held-out only the 16-30 in filled buckets, as totals.
          if (!HELD ? shape.startsWith("c") : /16-30in/.test(shape)) add(byBuilding, `${dir.slice(0, 30)} · ${shape.slice(0, 1)} 16-30in filled`, status, L);
        }
      }
    }
    show(`${HELD ? "HELD-OUT (totals only) — " : ""}by the shape of the hatch around the line`, byShape);
    show(HELD ? "HELD-OUT (totals only) — 16-30 in filled bands, by building" : "confined filled bands, by building", byBuilding);
    expect(found.length, "no training sheet was read").toBeGreaterThan(0);
  });
});
