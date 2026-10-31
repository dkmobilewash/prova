import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import { clipToWorkArea, wallsLikeThese, type Line } from "../userExclusions";
import type { WallCandidate } from "../wallVectors";

/**
 * ── THE USER, PLAYED FROM THE LABELS: WHAT TWO TOOLS WOULD DO WITHOUT ANY TUNING ──
 *
 * No rule can tell an existing wall from a new one on an unseen renovation
 * sheet (NOTES.md, 2026-10-30). The user can, so the question is how much
 * their click is worth. For each labelled sheet, on the product's offered
 * list (every set-aside applied), the labels stand in for the user:
 *
 *   EXCLUDE WALLS LIKE THIS — one click on the longest offered run the
 *   labels call junk (there is no "existing" label; a rejected run is the
 *   nearest thing), then every run drawn the same way is excluded. Reported
 *   after that one click, and then greedily — the longest remaining junk
 *   run again — until 80% of the sheet's junk is gone or ten clicks are
 *   spent: "clicks needed".
 *
 *   WORK AREA — one box, the bounds of the sheet's real key (accepted +
 *   traced walls), padded by 2 ft; runs outside set aside, runs across the
 *   edge split.
 *
 * Both report junk removed and real lost, per training sheet and as totals;
 * the held-out sets as ONE total and never per sheet. Nothing here tunes
 * anything: the tools have no thresholds the labels could move.
 *
 *   EX_SHEETS="baker/A100,murray/A101"   (optional)
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
type Saved = { page: number; feetPerUnit: number; verdicts: Verdict[]; traced?: G[] };
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

type Tally = { junk: number; real: number; other: number };
const tally = (): Tally => ({ junk: 0, real: 0, other: 0 });
const WORK_AREA_PAD_FEET = 2;
const CLICK_CAP = 10;
const CLICK_GOAL = 0.8;

describe.skipIf(DIR === "" || LABELS === "")("the user, played from the labels", () => {
  it("prices one click and one work-area box per sheet, in feet", { timeout: 7_200_000 }, async () => {
    const found: string[] = [];
    type Row = { name: string; held: boolean; offered: Tally; oneClick: Tally; clicks: number | null; afterClicks: Tally; careful: Tally; carefulClicks: number; box: Tally; boxSplit: number };
    const rows: Row[] = [];
    for (const dir of readdirSync(LABELS)) {
      if (!existsSync(join(LABELS, dir))) continue;
      const held = heldOutReason(dir) !== null;
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
        const verdictOf = (w: WallCandidate): keyof Tally => {
          const me = { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, th: w.thicknessFeet };
          const realC = coveredFeet(me, real, fpu), rej = coveredFeet(me, rejected, fpu);
          return realC >= 0.5 * w.lengthFeet ? "real" : rej >= 0.5 * w.lengthFeet ? "junk" : "other";
        };
        const runs = offered.offeredRuns;
        const verdicts = new Map(runs.map((w) => [w, verdictOf(w)] as const));
        const sum = (list: Iterable<WallCandidate>) => { const t = tally(); for (const w of list) t[verdicts.get(w) ?? "other"] += w.lengthFeet; return t; };
        const row: Row = { name: `${dir.slice(0, 22)}/${sheet}`, held, offered: sum(runs), oneClick: tally(), clicks: null, afterClicks: tally(), careful: tally(), carefulClicks: 0, box: tally(), boxSplit: 0 };

        // ── EXCLUDE WALLS LIKE THIS: the longest junk run, then greedily ──
        const clickOn = (w: WallCandidate): Line => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 });
        let remaining = [...runs];
        const clicks: Line[] = [];
        let excludedAll = new Set<WallCandidate>();
        const goal = CLICK_GOAL * row.offered.junk;
        for (let k = 0; k < CLICK_CAP; k += 1) {
          const target = remaining.filter((w) => verdicts.get(w) === "junk").sort((a, b) => b.lengthFeet - a.lengthFeet)[0];
          if (target === undefined) break;
          clicks.push(clickOn(target));
          const { excluded } = wallsLikeThese(clicks, runs, units, fpu);
          excludedAll = excluded;
          remaining = runs.filter((w) => !excluded.has(w));
          if (k === 0) row.oneClick = sum(excluded);
          const gone = sum(excluded).junk;
          if (gone >= goal) { row.clicks = k + 1; break; }
        }
        row.afterClicks = sum(excludedAll);

        // ── THE SAME USER, WHO READS THE COUNT AND UNDOES A BAD CLICK ──
        //
        // The tool shows what a click took and undoes it. So: longest junk run
        // not yet tried; keep the click only if what it ADDS is more junk than
        // real (the user sees walls they wanted vanish); at most ten kept.
        const kept: Line[] = [];
        const tried = new Set<WallCandidate>();
        let held0 = new Set<WallCandidate>();
        while (kept.length < CLICK_CAP) {
          const next = runs.filter((w) => verdicts.get(w) === "junk" && !held0.has(w) && !tried.has(w)).sort((a, b) => b.lengthFeet - a.lengthFeet)[0];
          if (next === undefined) break;
          tried.add(next);
          const trial = wallsLikeThese([...kept, clickOn(next)], runs, units, fpu).excluded;
          const added = sum([...trial].filter((w) => !held0.has(w)));
          if (added.junk > added.real) {
            kept.push(clickOn(next));
            held0 = trial;
          }
        }
        row.careful = sum(held0);
        row.carefulClicks = kept.length;

        // ── WORK AREA: the bounds of the real key, padded ──
        if (real.length > 0) {
          const pad = WORK_AREA_PAD_FEET / fpu;
          const xs = real.flatMap((r) => [r.x1, r.x2]), ys = real.flatMap((r) => [r.y1, r.y2]);
          const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
          const clipped = clipToWorkArea(runs, [{ xs: [x0, x1, x1, x0], ys: [y0, y0, y1, y1] }], fpu);
          row.box = sum(clipped.outside);
          // the outside feet of split runs, by the parent's verdict
          for (const s of clipped.split) {
            const v = verdicts.get(s.from) ?? "other";
            row.box[v] += s.from.lengthFeet - s.piece.lengthFeet;
          }
          row.boxSplit = clipped.split.length;
        }
        rows.push(row);
      }
    }
    const fmt = (t: Tally) => `junk ${t.junk.toFixed(0).padStart(5)} real ${t.real.toFixed(0).padStart(5)}`;
    const total = (list: Row[], pick: (r: Row) => Tally) => list.reduce((t, r) => { const x = pick(r); t.junk += x.junk; t.real += x.real; t.other += x.other; return t; }, tally());
    const training = rows.filter((r) => !r.held).sort((a, b) => b.offered.junk - a.offered.junk);
    const heldOut = rows.filter((r) => r.held);
    console.log("\n  TRAINING, per sheet — offered · one click (longest junk run) · clicks to 80% of junk (≤10, or '-') · work-area box from the real key");
    for (const r of training) console.log(`    ${r.name.padEnd(32)} offered ${fmt(r.offered)} · 1 click ${fmt(r.oneClick)} · clicks ${r.clicks === null ? "-" : String(r.clicks)} → ${fmt(r.afterClicks)} · careful ${r.carefulClicks} clicks ${fmt(r.careful)} · box ${fmt(r.box)} (${r.boxSplit} split)`);
    const tr = (pick: (r: Row) => Tally) => fmt(total(training, pick));
    console.log(`    ${"TRAINING TOTAL".padEnd(32)} offered ${tr((r) => r.offered)} · 1 click ${tr((r) => r.oneClick)} · clicks ${training.filter((r) => r.clicks !== null).length} of ${training.filter((r) => r.offered.junk > 0).length} sheets reach 80% (median ${median(training.filter((r) => r.clicks !== null).map((r) => r.clicks as number))}) → ${tr((r) => r.afterClicks)} · careful ${training.reduce((n, r) => n + r.carefulClicks, 0)} clicks ${tr((r) => r.careful)} · box ${tr((r) => r.box)}`);
    if (heldOut.length > 0) {
      const ho = (pick: (r: Row) => Tally) => fmt(total(heldOut, pick));
      console.log(`\n  HELD-OUT (${heldOut.length} sheets, totals only): offered ${ho((r) => r.offered)} · 1 click ${ho((r) => r.oneClick)} · clicks ${heldOut.filter((r) => r.clicks !== null).length} of ${heldOut.filter((r) => r.offered.junk > 0).length} sheets reach 80% (median ${median(heldOut.filter((r) => r.clicks !== null).map((r) => r.clicks as number))}) → ${ho((r) => r.afterClicks)} · careful ${heldOut.reduce((n, r) => n + r.carefulClicks, 0)} clicks ${ho((r) => r.careful)} · box ${ho((r) => r.box)}`);
    }
    expect(found.length, "no labelled sheet was read").toBeGreaterThan(0);
  });
});

function median(xs: number[]): number | string {
  if (xs.length === 0) return "-";
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
