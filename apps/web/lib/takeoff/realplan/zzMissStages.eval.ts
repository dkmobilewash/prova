import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import { FEATURE_NAMES } from "../wallFeatures";
import type { StrokeSegment, WallCandidate } from "../wallVectors";
const HATCH_AT = FEATURE_NAMES.indexOf("inHatchSeries");

/**
 * ── WHERE THE MISSED REAL WALL GOES, ON THE PRODUCT PATH ──
 *
 * `zzMissKinds` attributes misses on the RAW finder over the whole page.
 * This attributes them on what the app offers — `detectForSheet` with every
 * pairing hooked, then `offeredCandidates` with the sheet's words — so a
 * stage named here is a stage the estimator's list actually passed through:
 *
 *   set aside by a junk rule        a candidate covered the wall and a triage
 *                                   rule set it aside (the rule is named)
 *   found, off the plan boxes       the finder found it; the triage left it
 *                                   out as off the drawing
 *   paired, dropped by a filter     in `everywhere`, not in `walls`
 *   paired, lost to greedy or merge every pairing has it; `everywhere` has not
 *   merged into a different run     a found run on the same line, far longer
 *   outside the kept drawing        the wall's midpoint is off every plan box
 *   never paired: …                 single line drawn / both faces drawn /
 *                                   hatched / nothing drawn along it
 *
 * The key is accepted plus traced walls; missed feet are the scorer's own
 * uncovered feet against the OFFERED list. TRAINING sheets only.
 *
 *   REAL_PLAN_DIR=… REAL_PLAN_DIR2=… TAKEOFF_LABEL_DIR=… PROBE_OUT=rows.json
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.PROBE_OUT ?? "";
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
/** The scorer's covered feet: overlap of every other within the band, summed, capped at the length. */
function coveredFeet(a: G & { th: number }, others: readonly (G & { th: number })[], fpu: number): number {
  let covered = 0;
  for (const o of others) { if (!parallel(a, o)) continue; if (Math.max(offLine(a, o.x1, o.y1), offLine(a, o.x2, o.y2)) > band(a.th, o.th, fpu)) continue; covered += overlapAlong(a, o); }
  return Math.min(len(a), covered) * fpu;
}
/** Union coverage along `a` of the others within the band — for attribution, where five copies of one short pairing must not count five times. */
function unionCover(a: G & { th: number }, others: readonly (G & { th: number })[], fpu: number): number {
  const la = len(a); if (la === 0) return 0;
  const ux = (a.x2 - a.x1) / la, uy = (a.y2 - a.y1) / la;
  const spans: [number, number][] = [];
  for (const o of others) {
    if (!parallel(a, o)) continue;
    if (Math.max(offLine(a, o.x1, o.y1), offLine(a, o.x2, o.y2)) > band(a.th, o.th, fpu)) continue;
    const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
    const b1 = at(o.x1, o.y1), b2 = at(o.x2, o.y2);
    const lo = Math.max(0, Math.min(b1, b2)), hi = Math.min(la, Math.max(b1, b2));
    if (hi > lo) spans.push([lo, hi]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let covered = 0, cur = -1;
  for (const [lo, hi] of spans) { const from = Math.max(lo, cur); if (hi > from) { covered += hi - from; cur = hi; } }
  return covered / la;
}
const covers = (a: G & { th: number }, others: readonly (G & { th: number })[], fpu: number, share = 0.5) => unionCover(a, others, fpu) >= share;

describe.skipIf(DIR === "" || LABELS === "")("where the missed real wall goes, on the product path", () => {
  it("attributes every missed foot to a stage", { timeout: 7_200_000 }, async () => {
    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir)) || heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(join(LABELS, dir))) if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
    }
    files.sort((a, b) => a.dir.localeCompare(b.dir) || a.sheet.localeCompare(b.sheet));
    const rows: Record<string, unknown>[] = [];
    const byStage = new Map<string, { ft: number; per: Map<string, number> }>();
    const perSheet: { set: string; sheet: string; key: number; missed: number; extra: number }[] = [];
    for (const file of files) {
      const pdf = findPdf(file.dir);
      if (pdf === null) continue;
      const saved = JSON.parse(readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8")) as Saved;
      const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
      if (strokes === null) continue;
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(saved.page);
      await doc.close();
      const W = strokes.widthPt; const fpu = saved.feetPerUnit;
      const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const pairings: (WallCandidate & { hatch: boolean })[] = [];
      const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (f, w) => { pairings.push({ ...w, hatch: f[HATCH_AT] === 1 }); } });
      const offered = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W })), widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
      const toRun = (c: G & { thicknessFeet?: number; thicknessIn?: number | null }) => ({ x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, th: c.thicknessFeet ?? (c.thicknessIn ?? 0) / 12 });
      const offeredRuns = offered.candidates.map(toRun);
      const asideRuns = offered.setAsideLines.map((l) => ({ ...toRun({ ...l, thicknessFeet: 0 }), kind: l.kind }));
      const found = d.found.walls.map(toRun);
      const everywhere = d.found.everywhere.map(toRun);
      const paired = pairings.map((p) => ({ ...toRun(p), hatch: p.hatch }));
      const key = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced").map((v) => ({ ...v, th: v.thicknessFeet ?? 0 }));
      const keyFt = key.reduce((t, k) => t + len(k) * fpu, 0);
      const extra = offeredRuns.reduce((t, c) => t + Math.max(0, len(c) * fpu - coveredFeet(c, key, fpu)), 0);
      const units = d.found.inUnits as StrokeSegment[];
      let missedSheet = 0;
      for (const k of key) {
        const L = len(k) * fpu;
        const missed = Math.max(0, L - coveredFeet(k, offeredRuns, fpu));
        if (missed < 0.5) continue;
        missedSheet += missed;
        let stage: string;
        const asideHit = asideRuns.find((a) => parallel(k, a) && Math.max(offLine(k, a.x1, a.y1), offLine(k, a.x2, a.y2)) <= band(k.th, 0, fpu) && overlapAlong(k, a) >= 0.5 * Math.min(len(k), len(a)));
        const mx = (k.x1 + k.x2) / 2, my = (k.y1 + k.y2) / 2;
        const inBoxes = d.planBoxes === null || d.planBoxes.some((b) => mx >= b.from && mx < b.to && my >= b.fromY && my < b.toY);
        if (asideHit !== undefined) stage = `set aside by a junk rule: ${asideHit.kind}`;
        else if (covers(k, found, fpu)) stage = "found, off the plan boxes";
        else if (covers(k, everywhere, fpu)) stage = "paired, dropped by a filter (lettering, border, last)";
        else if (covers(k, paired, fpu)) stage = covers(k, paired.filter((p) => !p.hatch), fpu) ? "paired, lost to the greedy pass or the merge" : "paired, refused as a hatch series";
        else if (found.some((f) => parallel(k, f) && offLine(f, mx, my) * fpu <= 2.5 && len(f) > 1.8 * len(k) && overlapAlong(k, f) >= 0.5 * len(k))) stage = "merged into a different run";
        else if (!inBoxes) stage = "outside the kept drawing";
        else {
          // never paired: what is drawn along it
          const half = k.th > 0.05 ? k.th / 2 : 0;
          const faceCover = (side: 1 | -1) => {
            const dx = k.x2 - k.x1, dy = k.y2 - k.y1; const l = len(k); if (l === 0) return 0;
            let cov = 0;
            for (const s of units) {
              if (!parallel(k, s)) continue;
              const sx = (s.x1 + s.x2) / 2, sy = (s.y1 + s.y2) / 2;
              const cross = dx * (sy - k.y1) - dy * (sx - k.x1);
              const off = Math.abs(cross) / l * fpu;
              if (half > 0 ? (Math.sign(cross) !== side || Math.abs(off - half) > 0.3) : off > 0.75 || (side === -1 && cross >= 0) || (side === 1 && cross < 0)) continue;
              cov += overlapAlong(k, s);
            }
            return Math.min(1, cov / l);
          };
          const a = faceCover(1), b = faceCover(-1);
          const shortNear = units.filter((s) => len(s) * fpu <= 1.5 && offLine(k, (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2) * fpu <= 3 && overlapAlong(k, s) > 0).length;
          if (shortNear >= 30 && Math.max(a, b) < 0.5) stage = "never paired: hatched";
          else if (a >= 0.4 && b >= 0.4) stage = "never paired: both faces drawn";
          else if (Math.max(a, b) >= 0.4) stage = "never paired: single line drawn";
          else stage = "never paired: nothing drawn along it";
        }
        // PROBE DETAIL for the two pairing stages: the pairings that cover the wall, and the found runs beside it.
        const alongK = (g: G): [number, number] => { const l = len(k); const ux = (k.x2 - k.x1) / l, uy = (k.y2 - k.y1) / l; const a = ((g.x1 - k.x1) * ux + (g.y1 - k.y1) * uy) * fpu, b = ((g.x2 - k.x1) * ux + (g.y2 - k.y1) * uy) * fpu; return [+Math.min(a, b).toFixed(1), +Math.max(a, b).toFixed(1)]; };
        const nearK = (g: G & { th: number }) => parallel(k, g) && offLine(k, (g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2) * fpu <= 2.5 && overlapAlong(k, g) > 0;
        const detail = true
          ? {
              pairs: paired.filter(nearK).map((g) => ({ hatch: g.hatch, thIn: +(g.th * 12).toFixed(1), off: +(offLine(k, (g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2) * fpu).toFixed(2), along: alongK(g), L: +(len(g) * fpu).toFixed(1) })).slice(0, 8),
              everywhere: everywhere.filter(nearK).map((g) => ({ thIn: +(g.th * 12).toFixed(1), off: +(offLine(k, (g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2) * fpu).toFixed(2), along: alongK(g), L: +(len(g) * fpu).toFixed(1) })).slice(0, 6),
              found: found.filter(nearK).map((g) => ({ thIn: +(g.th * 12).toFixed(1), off: +(offLine(k, (g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2) * fpu).toFixed(2), along: alongK(g), L: +(len(g) * fpu).toFixed(1) })).slice(0, 6),
            }
          : null;
        const e = byStage.get(stage) ?? { ft: 0, per: new Map() };
        e.ft += missed; e.per.set(file.dir.slice(0, 22), (e.per.get(file.dir.slice(0, 22)) ?? 0) + missed); byStage.set(stage, e);
        rows.push({ set: file.dir, sheet: file.sheet, verdict: key.indexOf(k) >= 0 ? saved.verdicts.find((v) => v === (k as unknown as Verdict))?.verdict ?? "?" : "?", L: +L.toFixed(1), missed: +missed.toFixed(1), stage, x1: k.x1, y1: k.y1, x2: k.x2, y2: k.y2, thIn: +(k.th * 12).toFixed(1), page: saved.page, pdf, detail });
      }
      perSheet.push({ set: file.dir, sheet: file.sheet, key: +keyFt.toFixed(0), missed: +missedSheet.toFixed(0), extra: +extra.toFixed(0) });
      console.log(`  ${file.dir.slice(0, 26)}/${file.sheet}: key ${keyFt.toFixed(0)} missed ${missedSheet.toFixed(0)} extra ${extra.toFixed(0)}`);
    }
    const totalKey = perSheet.reduce((t, s) => t + s.key, 0), totalMissed = perSheet.reduce((t, s) => t + s.missed, 0), totalExtra = perSheet.reduce((t, s) => t + s.extra, 0);
    console.log(`\nTRAINING: key ${totalKey} ft, missed ${totalMissed} (recall ${(100 * (1 - totalMissed / totalKey)).toFixed(1)}%), extra ${totalExtra} (${(100 * totalExtra / totalKey).toFixed(0)} ft per 100 ft of key)\n`);
    for (const [stage, e] of [...byStage].sort((a, b) => b[1].ft - a[1].ft)) console.log(`  ${stage.padEnd(54)} ${e.ft.toFixed(0).padStart(6)} ft   top: ${[...e.per].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, f]) => `${s} ${f.toFixed(0)}`).join(", ")}`);
    if (OUT !== "") {
      writeFileSync(OUT, JSON.stringify({ rows, perSheet }));
      // the replay probe's format: one row per missed wall
      writeFileSync(OUT.replace(/\.json$/, "-rows.json"), JSON.stringify(rows.map((r) => ({ sheet: `${r.set}/${r.sheet}`, stage: r.stage, feet: r.missed, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }))));
    }
    expect(files.length).toBeGreaterThan(0);
  });
});
