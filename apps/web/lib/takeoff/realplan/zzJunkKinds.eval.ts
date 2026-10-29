import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { heldOutReason } from "../heldOutSets";
import { duplicatePairs } from "../duplicateCandidates";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── WHAT KIND OF THING IS THE PRODUCT OFFERING THAT A REVIEWER REJECTED? ──
 *
 * `zzRejectKinds` asks this of the RAW finder on the whole page. This asks it
 * of what the app offers — `detectForSheet` then `offeredCandidates`, the
 * sweep's own path, with the sheet's words handed to the triage as the app
 * hands them — and counts only CONFIRMED junk: the feet of an offered
 * candidate that lie on a `not-wall` verdict and on no real wall. Unlabelled
 * extra is reported on its own line and is not junk until somebody says so.
 *
 * Kinds are inferred from nearby words, the candidate's own shape and its
 * company, and are a ranking to aim at, not a measurement of cause; the crops
 * are where they are checked. Training sheets only (`heldOutReason`).
 *
 *     REAL_PLAN_DIR=… REAL_PLAN_DIR2=… TAKEOFF_LABEL_DIR=… PROBE_OUT=rows.json \
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzJunkKinds.eval.ts
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
/** The scorer's own band: half the thicker one plus 0.5 ft, floor 1.5, cap 3 — in page units. */
const band = (aTh: number, bTh: number, fpu: number) => Math.min(3, Math.max(1.5, Math.max(aTh, bTh) / 2 + 0.5)) / fpu;
/** Feet of `a` lying within the band of any of `others`, union-free (as the scorer sums it). */
function coveredFeet(a: G & { th: number }, others: readonly (G & { th: number })[], fpu: number): number {
  let covered = 0;
  for (const o of others) { if (!parallel(a, o)) continue; if (Math.max(offLine(a, o.x1, o.y1), offLine(a, o.x2, o.y2)) > band(a.th, o.th, fpu)) continue; covered += overlapAlong(a, o); }
  return Math.min(len(a), covered) * fpu;
}

type Kind =
  | "kennel / fence / run grid"
  | "text or tag box"
  | "dimension / leader"
  | "stacked dimension strings"
  | "hatch lines"
  | "casework / counters / shelves"
  | "furniture / fixtures"
  | "repeated unit-plan shape"
  | "face-only duplicate of a real wall"
  | "grid line"
  | "other: thin (<2 in)"
  | "other: short (<3 ft)"
  | "other: plausible wall the key rejected";

const KENNEL = /KENNEL|\bRUNS?\b|FENC|GATE|PLAY ?YARD|CHAIN ?LINK|\bDOG\b|CURB|TRENCH/i;
const CASEWORK = /COUNTER|CASEWORK|MILLWORK|CABINET|\bCAB\b|SHELV|SHELF|WARDROBE|\bROD\b|UPPER|BASE\b|VANITY|W\/D|WASHER|DRYER|\bREF\b|REFRIG|\bDW\b|DISHW|RANGE|OVEN|MICRO|ISLAND|PANTRY/i;
const FIXTURE = /TOILET|\bLAV\b|\bWC\b|\bTUB\b|SHOWER|URINAL|\bSINK\b|DESK|TABLE|CHAIR|\bBED\b|SOFA|BENCH|LOCKER|GRAB BAR|DRINKING|\bEWC\b|MOP/i;
const DIMENSION = /^[\d'"\-\s./±+]+$/;


describe.skipIf(DIR === "" || LABELS === "")("confirmed junk on the product path, by kind", () => {
  it("breaks the rejected footage the app offers into kinds, in feet", { timeout: 7_200_000 }, async () => {
    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir)) || heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(join(LABELS, dir))) if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
    }
    files.sort((a, b) => a.dir.localeCompare(b.dir) || a.sheet.localeCompare(b.sheet));
    const rows: Record<string, unknown>[] = [];
    const allRows: Record<string, unknown>[] = [];
    const perKind = new Map<string, { ft: number; n: number }>();
    const add = (k: string, ft: number) => { const e = perKind.get(k) ?? { ft: 0, n: 0 }; e.ft += ft; e.n += 1; perKind.set(k, e); };
    let unlabelledExtra = 0, unsureExtra = 0, confirmed = 0, offeredFt = 0, realFt = 0;
    const perSheet: string[] = [];
    for (const file of files) {
      const pdf = findPdf(file.dir);
      if (pdf === null) { console.log(`  ${file.dir}/${file.sheet}: no pdf`); continue; }
      const saved = JSON.parse(readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8")) as Saved;
      const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
      if (strokes === null) continue;
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(saved.page);
      await doc.close();
      const W = strokes.widthPt; const fpu = saved.feetPerUnit;
      const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu });
      const offered = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W })), widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
      const words = textItems.map((i) => ({ str: i.str.trim(), x: (i.x + i.width / 2) / W, y: (i.y - i.height / 2) / W })).filter((w) => w.str !== "");
      const toRun = (v: Verdict) => ({ ...v, th: v.thicknessFeet ?? 0 });
      const real = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced").map(toRun);
      const rejected = saved.verdicts.filter((v) => v.verdict === "not-wall").map(toRun);
      const unsure = saved.verdicts.filter((v) => v.verdict === "unsure").map(toRun);
      const keyBox = real.reduce((b, k) => ({ x1: Math.min(b.x1, k.x1, k.x2), y1: Math.min(b.y1, k.y1, k.y2), x2: Math.max(b.x2, k.x1, k.x2), y2: Math.max(b.y2, k.y1, k.y2) }), { x1: 1, y1: 1, x2: 0, y2: 0 });
      const span = Math.max(keyBox.x2 - keyBox.x1, keyBox.y2 - keyBox.y1);
      const cands = offered.candidates.map((c) => ({ ...c, th: (c.thicknessIn ?? 0) / 12 }));
      // What the review tool's own duplicate check would drop, with the sheet's lines in hand.
      const dupDrops = new Set(duplicatePairs(offered.candidates, fpu, d.found.inUnits).map((p) => p.drop));
      const shortStrokes = d.found.inUnits.filter((s: StrokeSegment) => len(s) * fpu <= 1);
      let sheetJunk = 0; const sheetKinds = new Map<string, number>();

      const alongT = (c: G, w: { x: number; y: number }) => { const l = len(c); return ((w.x - c.x1) * (c.x2 - c.x1) + (w.y - c.y1) * (c.y2 - c.y1)) / (l * l); };
      const perpTouch = (c: G, o: G) => { if (parallel(c, o)) return false; const p = Math.atan2(c.y2 - c.y1, c.x2 - c.x1), q = Math.atan2(o.y2 - o.y1, o.x2 - o.x1); if (Math.abs(Math.cos(p - q)) > 0.26) return false; for (const [x, y] of [[o.x1, o.y1], [o.x2, o.y2]] as const) { const t = alongT(c, { x, y }); if (t >= -0.02 && t <= 1.02 && offLine(c, x, y) * fpu <= 1.5) return true; } return false; };
      for (const c of cands) {
        const L = c.lengthFeet; offeredFt += L;
        const realC = coveredFeet(c, real, fpu); realFt += realC;
        const extra = Math.max(0, L - realC);
        const rej = extra < 0.5 ? 0 : Math.min(extra, coveredFeet(c, rejected, fpu));
        const uns = extra < 0.5 ? 0 : Math.min(extra - rej, coveredFeet(c, unsure, fpu));
        // ── FEATURES FOR EVERY CANDIDATE, REAL OR NOT, SO A RULE CAN BE PRICED ──
        const halfBand = (c.th * 12) / 24 + 0.4; // ft from the centreline that counts as "between the faces"
        const dimWords = words.filter((w) => DIMENSION.test(w.str) && /\d/.test(w.str));
        const inRun = (w: { x: number; y: number }) => { const t = alongT(c, w); return t >= -0.05 && t <= 1.05; };
        const dimBetween = dimWords.filter((w) => inRun(w) && offLine(c, w.x, w.y) * fpu <= halfBand).length;
        const dimNear = dimWords.filter((w) => inRun(w) && offLine(c, w.x, w.y) * fpu <= 1.5).length;
        const anyBetween = words.filter((w) => inRun(w) && offLine(c, w.x, w.y) * fpu <= halfBand).length;
        const tees = cands.filter((o) => o !== c && perpTouch(c, o)).length;
        // ── IS EITHER FACE DASHED? pieces of the face along the run, and how much of the run they cover ──
        const half = c.th / 2;
        const faceOf = (sign: 1 | -1) => {
          const pieces: [number, number][] = [];
          for (const sg of d.found.inUnits as StrokeSegment[]) {
            if (!parallel(c, sg)) continue;
            const smx = (sg.x1 + sg.x2) / 2, smy = (sg.y1 + sg.y2) / 2;
            const l = len(c); const sideSign = Math.sign((c.x2 - c.x1) * (smy - c.y1) - (c.y2 - c.y1) * (smx - c.x1)) || 1;
            if (sideSign !== sign && c.th > 0.05) continue;
            if (Math.abs(offLine(c, smx, smy) * fpu - half) > 0.25) continue;
            const t1 = alongT(c, { x: sg.x1, y: sg.y1 }), t2 = alongT(c, { x: sg.x2, y: sg.y2 });
            const a = Math.max(0, Math.min(t1, t2)) * l * fpu, b = Math.min(1, Math.max(t1, t2)) * l * fpu;
            if (b > a) pieces.push([a, b]);
          }
          pieces.sort((x, y) => x[0] - y[0]);
          let covered = 0, cur = -1, longest = 0, n = 0; const lens: number[] = []; const gaps: number[] = [];

          for (const [a0, b0] of pieces) { const a1 = Math.max(a0, cur); if (b0 > a1) { if (cur >= 0 && a1 - cur > 0.05) gaps.push(a1 - cur); covered += b0 - a1; cur = b0; n += 1; longest = Math.max(longest, b0 - a0); lens.push(b0 - a1); } }
          const med = (xs: number[]) => xs.length === 0 ? 0 : [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
          const cv = (xs: number[]) => { if (xs.length < 2) return 0; const m = xs.reduce((t, x) => t + x, 0) / xs.length; return m === 0 ? 0 : Math.sqrt(xs.reduce((t, x) => t + (x - m) * (x - m), 0) / xs.length) / m; };
          return { n, cover: +(covered / Math.max(L, 0.01)).toFixed(2), longest: +longest.toFixed(1), medPiece: +med(lens).toFixed(2), medGap: +med(gaps).toFixed(2), cvPiece: +cv(lens).toFixed(2), cvGap: +cv(gaps).toFixed(2) };
        };
        const fA = faceOf(1), fB = faceOf(-1);
        // A dash pattern: several SHORT pieces with short regular gaps, covering a fair share of the run — not a face broken by doors.
        const isDashed = (f: { n: number; cover: number; longest: number; medPiece: number; medGap: number }) => f.n >= 5 && f.longest <= 2.5 && f.medGap > 0 && f.medGap <= 2.5 && f.cover >= 0.25 && f.cover <= 0.9;
        const dashedA = isDashed(fA), dashedB = isDashed(fB);
        const dashWords = words.filter((w) => Math.hypot(w.x - (c.x1 + c.x2) / 2, w.y - (c.y1 + c.y2) / 2) * fpu <= 10).map((w) => w.str).slice(0, 6);
        allRows.push({ set: file.dir, sheet: file.sheet, x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, fpu, span: +(span * fpu).toFixed(0), L: +L.toFixed(1), thIn: +((c.thicknessIn ?? 0)).toFixed(1), from: c.from, realC: +realC.toFixed(1), rej: +rej.toFixed(1), uns: +uns.toFixed(1), dimBetween, dimNear, anyBetween, tees, fA, fB, dashedA, dashedB, dashWords, dupDrop: dupDrops.has(c.id) });
        if (extra < 0.5) continue;
        unsureExtra += uns; unlabelledExtra += extra - rej - uns;
        if (rej < 0.5) continue;
        confirmed += rej; sheetJunk += rej;
        const mx = (c.x1 + c.x2) / 2, my = (c.y1 + c.y2) / 2;
        const within = (ft: number) => words.filter((w) => Math.hypot(w.x - mx, w.y - my) * fpu <= ft);
        const hasWord = (re: RegExp, ft: number) => within(ft).some((w) => re.test(w.str));
        // a word sitting BETWEEN the faces, along the run
        const between = words.some((w) => offLine(c, w.x, w.y) * fpu <= c.th * 12 / 24 + 0.4 && overlapAlong(c, { x1: w.x, y1: w.y, x2: w.x, y2: w.y }) >= 0 && (() => { const l = len(c); const t = ((w.x - c.x1) * (c.x2 - c.x1) + (w.y - c.y1) * (c.y2 - c.y1)) / (l * l); return t >= -0.05 && t <= 1.05; })());
        const companions = cands.filter((o) => o !== c && parallel(c, o) && offLine(c, (o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2) * fpu <= 3 && Math.abs(o.lengthFeet - L) <= Math.max(0.5, L * 0.25)).length;
        const twins = cands.filter((o) => o !== c && parallel(c, o) && Math.abs(o.lengthFeet - L) <= 0.25 && Math.abs((o.thicknessIn ?? 0) - (c.thicknessIn ?? 0)) <= 0.5 && Math.hypot((o.x1 + o.x2) / 2 - mx, (o.y1 + o.y2) / 2 - my) * fpu > 3).length;
        const dup = real.some((k) => parallel(c, k) && offLine(k, mx, my) * fpu <= Math.max(2, k.th + 1) && Math.abs(L - k.lengthFeet) <= Math.max(3, k.lengthFeet * 0.5));
        const axis = Math.abs(c.y2 - c.y1) < len(c) * 0.02 || Math.abs(c.x2 - c.x1) < len(c) * 0.02;
        const dense = shortStrokes.filter((s) => Math.hypot((s.x1 + s.x2) / 2 - mx, (s.y1 + s.y2) / 2 - my) * fpu <= 4).length;
        const thIn = c.thicknessIn ?? 0;
        let kind: Kind;
        if (hasWord(KENNEL, 15)) kind = "kennel / fence / run grid";
        else if (dimBetween >= 1 || (dimNear >= 2 && thIn <= 14)) kind = "stacked dimension strings";
        else if (between && L <= 12) kind = "text or tag box";
        else if (within(2.5).some((w) => DIMENSION.test(w.str) && /\d/.test(w.str)) && (thIn <= 3 || c.from === "single")) kind = "dimension / leader";
        else if (L <= 4 && companions >= 4) kind = "hatch lines";
        else if (hasWord(CASEWORK, 8)) kind = "casework / counters / shelves";
        else if (hasWord(FIXTURE, 6) || (L <= 4 && dense >= 25)) kind = "furniture / fixtures";
        else if (twins >= 3) kind = "repeated unit-plan shape";
        else if (dup) kind = "face-only duplicate of a real wall";
        else if (axis && len(c) >= span * 0.85) kind = "grid line";
        else if (thIn > 0 && thIn < 2) kind = "other: thin (<2 in)";
        else if (L < 3) kind = "other: short (<3 ft)";
        else kind = "other: plausible wall the key rejected";
        add(kind, rej); sheetKinds.set(kind, (sheetKinds.get(kind) ?? 0) + rej);
        rows.push({ set: file.dir, sheet: file.sheet, pdf, page: saved.page, x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, lengthFeet: +L.toFixed(1), thIn: +thIn.toFixed(1), from: c.from, note: c.note, extra: +extra.toFixed(1), rej: +rej.toFixed(1), kind, words: within(8).slice(0, 5).map((w) => w.str), companions, twins, dense, dimBetween, dimNear, tees });
      }
      perSheet.push(`  ${file.dir.slice(0, 24).padEnd(24)}/${file.sheet.padEnd(7)} offered ${offered.candidates.length} · confirmed junk ${sheetJunk.toFixed(0)} ft · ${[...sheetKinds].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ")}`);
    }
    console.log(`\nCONFIRMED JUNK ON THE PRODUCT PATH, TRAINING SHEETS (${files.length} label files)`);
    console.log(`offered ${offeredFt.toFixed(0)} ft · on a real wall ${realFt.toFixed(0)} · confirmed junk ${confirmed.toFixed(0)} · on an unsure verdict ${unsureExtra.toFixed(0)} · unlabelled extra ${unlabelledExtra.toFixed(0)}\n`);
    for (const [k, e] of [...perKind].sort((a, b) => b[1].ft - a[1].ft)) console.log(`  ${k.padEnd(42)} ${e.ft.toFixed(0).padStart(6)} ft  ${String(e.n).padStart(4)} runs`);
    console.log(""); for (const line of perSheet) console.log(line);
    if (OUT !== "") { writeFileSync(OUT, JSON.stringify(rows, null, 1)); writeFileSync(OUT.replace(/\.json$/, "-all.json"), JSON.stringify(allRows)); }
    expect(files.length).toBeGreaterThan(0);
  });
});
