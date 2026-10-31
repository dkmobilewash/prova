import { Buffer } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { keyFromLabels } from "../heldOutScore";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import { insideView, sheetDrawings } from "../sheetViews";
import { planLevel, viewClass } from "../viewTitles";

/**
 * ── WHICH VIEW EACH OFFERED FOOT CAME FROM, ON A MULTI-VIEW SHEET ──
 *
 * The sweep says a sheet was split into N drawings and which were kept; it
 * cannot say where the EXTRA feet sit. This puts every offered candidate and
 * every key wall into the view whose box holds its midpoint, and labels the
 * candidate real / junk / unverdicted from the sheet's label file — so "the
 * key plan leaked" and "the kept plan itself is junk" stop being the same
 * number. Diagnostic; training sheets only.
 *
 *   LEAK_SHEETS="bunkie/A104,camp_bow/A120" REAL_PLAN_DIR=… REAL_PLAN_DIR2=… TAKEOFF_LABEL_DIR=… \
 *     npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzViewLeak.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const SHEETS = (process.env.LEAK_SHEETS ?? "").split(",").filter((s) => s !== "");
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

describe.skipIf(DIR === "" || LABELS === "" || SHEETS.length === 0)("where a multi-view sheet's offered feet come from", () => {
  it("attributes every offered and key foot to a view", { timeout: 1_800_000 }, async () => {
    const found: string[] = [];
    for (const dir of readdirSync(LABELS)) {
      for (const name of readdirSync(join(LABELS, dir))) {
        if (!name.endsWith(".json")) continue;
        const sheet = name.slice(0, -5);
        if (!SHEETS.some((s) => { const [d, sh] = s.split("/"); return dir.toLowerCase().includes(d.toLowerCase()) && sh === sheet; })) continue;
        const pdf = findPdf(dir);
        if (pdf === null) { console.log(`  ${dir}/${sheet}: no pdf`); continue; }
        found.push(`${dir}/${sheet}`);
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Saved;
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null) { console.log(`  ${dir}/${sheet}: unreadable`); continue; }
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        await doc.close();
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const W = strokes.widthPt;
        const pageSize = { widthPt: W, heightPt: strokes.heightPt };
        const fpu = saved.feetPerUnit;
        const views = sheetDrawings({ items: textItems, segments: strokes.segments, pageSize });
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize, feetPerUnit: fpu });
        const offered = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W })), widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
        const toRun = (v: Verdict) => ({ ...v, th: v.thicknessFeet ?? 0 });
        const real = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced").map(toRun);
        const rejected = saved.verdicts.filter((v) => v.verdict === "not-wall").map(toRun);
        const { key } = keyFromLabels(saved);
        const keptNames = new Set(d.kept.map((k) => k.name));
        const otherNames = new Set(d.others.map((o) => o.view.name));
        const leftOut = new Map(d.leftOut.map((l) => [l.name, l.reason]));
        const tally = new Map<string, { real: number; junk: number; other: number; key: number }>();
        const bucket = (n: string) => { let t = tally.get(n); if (!t) { t = { real: 0, junk: 0, other: 0, key: 0 }; tally.set(n, t); } return t; };
        const viewOf = (mx: number, my: number) => views.find((v) => insideView(v, mx, my))?.name ?? "(no view box)";
        for (const c of offered.candidates) {
          const me = { x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, th: (c.thicknessIn ?? 0) / 12 };
          const L = c.lengthFeet;
          const realC = coveredFeet(me, real, fpu), rej = coveredFeet(me, rejected, fpu);
          const t = bucket(viewOf((c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2));
          if (realC >= 0.5 * L) t.real += L; else if (rej >= 0.5 * L) t.junk += L; else t.other += L;
        }
        for (const k of key) bucket(viewOf((k.x1 + k.x2) / 2, (k.y1 + k.y2) / 2)).key += len(k) * fpu;
        console.log(`\n${dir}/${sheet} · page ${saved.page} · ${views.length} views, detector says ${d.views} drawings, kept ${d.kept.length}, others ${d.others.length}, leftOut ${d.leftOut.length}${d.wholeSheet ? " · WHOLE-SHEET FALLBACK" : ""}`);
        for (const v of views) {
          const t = tally.get(v.name) ?? { real: 0, junk: 0, other: 0, key: 0 };
          const role = keptNames.has(v.name) ? "KEPT" : otherNames.has(v.name) ? "other" : leftOut.has(v.name) ? `left out (${leftOut.get(v.name)})` : v.textBlock ? "text block" : "—";
          const cls = viewClass(v.name);
          console.log(`  ${v.name.slice(0, 44).padEnd(44)} ${role.padEnd(40)} ${cls.kind.padEnd(14)} level ${String(planLevel(v.name)).padEnd(6)} scale ${String(v.scaleName).padEnd(14)} offered real ${t.real.toFixed(0).padStart(5)} junk ${t.junk.toFixed(0).padStart(5)} unverdicted ${t.other.toFixed(0).padStart(5)} · key here ${t.key.toFixed(0).padStart(5)}`);
        }
        const none = tally.get("(no view box)");
        if (none) console.log(`  ${"(no view box)".padEnd(44)} ${"".padEnd(40)} ${"".padEnd(14)} ${"".padEnd(13)} ${"".padEnd(20)} offered real ${none.real.toFixed(0).padStart(5)} junk ${none.junk.toFixed(0).padStart(5)} unverdicted ${none.other.toFixed(0).padStart(5)} · key here ${none.key.toFixed(0).padStart(5)}`);
      }
    }
    expect(found.length, "no named sheet was found — check LEAK_SHEETS against TAKEOFF_LABEL_DIR").toBeGreaterThan(0);
  });
});
