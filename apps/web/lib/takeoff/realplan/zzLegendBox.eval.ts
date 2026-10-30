import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── OFFERED CANDIDATES THAT ARE THE SIDE OF A TEXT-FILLED BOX ──
 *
 * For every offered candidate on a training sheet: how many words sit within
 * 3 ft on each side along its span, whether another offered candidate meets
 * each of its ends at a right angle (a box corner), and whether a title word
 * (LEGEND, SCHEDULE, KEY NOTES, WALL TYPES, NOTES, SYMBOLS, ABBREVIATIONS)
 * sits within 2 ft. Scored against the labels. The prize for a legend-box
 * rule is the feet in the "cornered both ends, text-dense one side" bucket.
 *
 *   LB_SHEETS="joplin/G-101,joplin/A-101" (optional; default every training sheet)
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const ONLY = (process.env.LB_SHEETS ?? "").split(",").filter((s) => s !== "");
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
const perpendicular = (a: G, b: G) => { const p = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), q = Math.atan2(b.y2 - b.y1, b.x2 - b.x1); return Math.abs(Math.cos(p - q)) <= 0.26; };
function offLine(a: G, px: number, py: number): number { const l = len(a); if (l === 0) return Math.hypot(px - a.x1, py - a.y1); return Math.abs((a.x2 - a.x1) * (a.y1 - py) - (a.x1 - px) * (a.y2 - a.y1)) / l; }
function overlapAlong(a: G, b: G): number { const la = len(a); if (la === 0) return 0; const ux = (a.x2 - a.x1) / la, uy = (a.y2 - a.y1) / la; const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy; const b1 = at(b.x1, b.y1), b2 = at(b.x2, b.y2); return Math.max(0, Math.min(la, Math.max(b1, b2)) - Math.max(0, Math.min(b1, b2))); }
const band = (aTh: number, bTh: number, fpu: number) => Math.min(3, Math.max(1.5, Math.max(aTh, bTh) / 2 + 0.5)) / fpu;
function coveredFeet(a: G & { th: number }, others: readonly (G & { th: number })[], fpu: number): number {
  let covered = 0;
  for (const o of others) { if (!parallel(a, o)) continue; if (Math.max(offLine(a, o.x1, o.y1), offLine(a, o.x2, o.y2)) > band(a.th, o.th, fpu)) continue; covered += overlapAlong(a, o); }
  return Math.min(len(a), covered) * fpu;
}
const TITLE = /\b(LEGEND|SCHEDULES?|KEY ?NOTES?|KEYED NOTES?|WALL TYPES?|NOTES?|SYMBOLS?|ABBREVIATIONS?)\b/i;
type Tally = { real: number; junk: number; other: number; n: number };
const fresh = (): Tally => ({ real: 0, junk: 0, other: 0, n: 0 });

describe.skipIf(DIR === "" || LABELS === "")("offered candidates that are the side of a text box", () => {
  it("tallies them by shape against the labels", { timeout: 7_200_000 }, async () => {
    const found: string[] = [];
    const byShape = new Map<string, Tally>(), bySheet = new Map<string, Tally>();
    const add = (m: Map<string, Tally>, k: string, st: "real" | "junk" | "other", L: number) => { const t = m.get(k) ?? fresh(); t[st] += L; t.n += 1; m.set(k, t); };
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
        const offered = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W })), widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
        const toRun = (v: Verdict) => ({ ...v, th: v.thicknessFeet ?? 0 });
        const real = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced").map(toRun);
        const rejected = saved.verdicts.filter((v) => v.verdict === "not-wall").map(toRun);
        const cands = offered.candidates;
        if (process.env.LB_DUMP === "1") {
          for (const a of offered.setAside.filter((x) => x.kind === "legend-box")) console.log(`    BOX ${sheet} n ${a.n}: ${a.why}`);
          for (const l of offered.setAsideLines.filter((x) => x.kind === "legend-box")) console.log(`    BOXLINE ${sheet} ${l.lengthFeet.toFixed(0)}ft at ${l.x1.toFixed(4)},${l.y1.toFixed(4)} -> ${l.x2.toFixed(4)},${l.y2.toFixed(4)}`);
        }
        for (const c of cands) {
          const me = { x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, th: (c.thicknessIn ?? 0) / 12 };
          const L = c.lengthFeet;
          const realC = coveredFeet(me, real, fpu), rej = coveredFeet(me, rejected, fpu);
          const st: "real" | "junk" | "other" = realC >= 0.5 * L ? "real" : rej >= 0.5 * L ? "junk" : "other";
          const ux = (c.x2 - c.x1) / len(c), uy = (c.y2 - c.y1) / len(c);
          const side = (x: number, y: number) => ((x - c.x1) * -uy + (y - c.y1) * ux) * fpu;
          const along = (x: number, y: number) => ((x - c.x1) * ux + (y - c.y1) * uy) / len(c);
          let plus = 0, minus = 0, title = false;
          for (const w of words) {
            const a = along(w.x, w.y); if (a < -0.05 || a > 1.05) continue;
            const s = side(w.x, w.y);
            if (Math.abs(s) <= 3) { if (s > 0) plus += 1; else minus += 1; }
            if (Math.abs(s) <= 2 && TITLE.test(w.str)) title = true;
          }
          const corner = (x: number, y: number) => cands.some((o) => o !== c && perpendicular(c, o) && Math.min(Math.hypot(o.x1 - x, o.y1 - y), Math.hypot(o.x2 - x, o.y2 - y)) * fpu <= 1.5);
          const corners = (corner(c.x1, c.y1) ? 1 : 0) + (corner(c.x2, c.y2) ? 1 : 0);
          const dense = Math.max(plus, minus) / L; // words per foot on the busier side
          const shape = `${corners === 2 ? "cornered both ends" : corners === 1 ? "one corner" : "no corners"} · ${dense >= 1.5 ? "text-dense (≥1.5 words/ft)" : dense >= 0.5 ? "some text" : "little text"} · ${title ? "TITLE near" : "no title"}`;
          add(byShape, shape, st, L);
          if (process.env.LB_DUMP === "1" && st !== "real") console.log(`    DUMP ${sheet} ${st} ${L.toFixed(0)}ft corners ${corners} words+ ${plus} words- ${minus}${title ? " TITLE" : ""} th ${c.thicknessIn ?? "-"} at ${c.x1.toFixed(4)},${c.y1.toFixed(4)} -> ${c.x2.toFixed(4)},${c.y2.toFixed(4)}`);
          if (corners === 2 && dense >= 1.5) add(bySheet, `${dir.slice(0, 24)}/${sheet}`, st, L);
        }
      }
    }
    const show = (t: string, m: Map<string, Tally>) => { console.log(`\n  ${t}`); for (const [k, v] of [...m].sort((a, b) => b[1].junk + b[1].other - a[1].junk - a[1].other)) console.log(`    ${k.padEnd(70)} n ${String(v.n).padStart(4)} real ${v.real.toFixed(0).padStart(6)} junk ${v.junk.toFixed(0).padStart(6)} unverdicted ${v.other.toFixed(0).padStart(6)}`); };
    show("by shape", byShape); show("cornered both ends + text-dense, by sheet", bySheet);
    expect(found.length, "no training sheet was read").toBeGreaterThan(0);
  });
});
