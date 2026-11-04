import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import type { ScoredPairing } from "../demotedRuns";
import { demoRuns } from "../demoWalls";
import { runsHeldOffEstimate } from "../estimateHold";
import { existingWalls, legendPens, textRows } from "../existingWalls";
import { existingWallSet } from "../existingWallSet";
import { findWallsOnSheet, inPageWidthUnits } from "../findWallsOnSheet";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { FEW_WALLS_SHARE, MIN_VOTES, onPriorPlan, type PriorLine } from "../planCompare";
import { sheetStrokes } from "../sheetStrokes";
import { alignViews } from "../viewAlign";
import { loadWallModel } from "../wallModelFile";
import type { WallCandidate } from "../wallVectors";
import { longFaces, pairsForSet, type Line } from "./planPairs";

/**
 * ── HOW A RENOVATION SHEET SAYS WHAT IS EXISTING, AND WHAT EACH PARKED RULE WOULD DO ──
 *
 * Every labelled sheet: the app's offered runs (today's set-asides applied),
 * which conventions the sheet carries (a legend's existing-wall swatch, a
 * paired demolition plan, two pens, fill against outline), and for each parked
 * rule — the sheet's own two pens (`existingWalls` route 3) and plan comparison
 * against the paired demolition plan (`planCompare`) — the real and junk feet
 * it would set aside and posted-vs-key at the shipped hold before and after.
 * Per building on training; `RENO_HELD=1` is held-out, TOTALS ONLY. Needs
 * TAKEOFF_WALL_MODEL.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.RENO_OUT ?? "";
const HELD = process.env.RENO_HELD === "1";
const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
const findPdf = (dir: string) => {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const n of readdirSync(root)) if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return join(root, n);
  return null;
};
type Saved = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number };
type Rule = "pens" | "compare";
type Arm = { real: number; junk: number; posted: number };
type Row = { set: string; sheet: string; renovation: boolean; legend: boolean; demoPair: string | null; twoPens: boolean; filledReal: number; filledJunk: number; outlineReal: number; outlineJunk: number; key: number; posted: number; rules: Record<Rule, Arm> };

describe.skipIf(DIR === "" || LABELS === "" || OUT === "" || process.env.TAKEOFF_WALL_MODEL === undefined)("renovation conventions and the parked rules", () => {
  it("measures each sheet", { timeout: 7_200_000 }, async () => {
    const config = loadWallModel();
    if (config === null) throw new Error("no wall model");
    const rows: Row[] = [];
    const pairsBySet = new Map<string, Awaited<ReturnType<typeof pairsForSet>>>();
    for (const dir of readdirSync(LABELS).sort()) {
      if (!existsSync(join(LABELS, dir)) || (heldOutReason(dir) !== null) !== HELD) continue;
      let names: string[] = [];
      try { names = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")); } catch { continue; }
      const pdf = findPdf(dir);
      if (pdf === null) continue;
      const only = (process.env.RENO_ONLY ?? "").split(",").filter(Boolean);
      if (only.length > 0 && !only.some((o) => dir.includes(o))) continue;
      for (const name of names) {
        const sheet = name.slice(0, -5);
        if (excludedSheetReason(dir, sheet) !== null) continue;
        const saved = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Saved;
        const { key } = keyFromLabels(saved);
        if (key.length === 0) continue;
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        if (strokes === null || strokes.segments.length < 50) continue;
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const text = await doc.pageText(saved.page);
        const W = strokes.widthPt, fpu = saved.feetPerUnit;
        const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const words = textRows(textItems).map((r) => r.str).join("\n");
        const count = (re: RegExp) => (words.match(re) ?? []).length;
        const renovation = count(/\(E\)/gi) > 0 || count(/\bEXIST/gi) >= 3 || /RENOVATION|REMODEL|TENANT IMPROVEMENT|\bDEMO/i.test(words);
        const scored: ScoredPairing[] = [];
        const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, onCandidate: (f, w) => { scored.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet, features: [...f] }); } });
        const runs = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems }).offeredRuns;
        const isJunk = (r: WallCandidate) => scoreSheet({ set: dir, sheet, key, proposed: [{ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, thicknessFeet: r.thicknessFeet } as ScoredRun], feetPerUnit: fpu }).extraFeet >= 0.5 * r.lengthFeet;
        const junk = new Map(runs.map((r) => [r, isJunk(r)]));
        const keyFeet = scoreSheet({ set: dir, sheet, key, proposed: [], feetPerUnit: fpu }).keyFeet;
        const held = new Set(runsHeldOffEstimate(config.model, runs, scored, fpu, false));
        const posted = (without: ReadonlySet<WallCandidate>) => runs.reduce((n, r) => n + (held.has(r) || without.has(r) ? 0 : r.lengthFeet), 0);
        const units = d.found.inUnits;
        const pageUnits = strokes.segments.map(inPageWidthUnits(W));

        // Conventions.
        const legend = legendPens(textRows(textItems), pageUnits, W).existing !== null;
        const penned = existingWalls({ walls: runs, segments: units, pageSegments: pageUnits, textItems, widthPt: W, feetPerUnit: fpu, sheetPens: true }).filter((e) => e.route === "pen").map((e) => e.wall);
        let filledReal = 0, filledJunk = 0, outlineReal = 0, outlineJunk = 0;
        for (const r of runs) {
          const near = units.filter((s) => s.fill !== undefined && s.fill <= 0.85 && Math.min(Math.hypot((s.x1 + s.x2) / 2 - (r.x1 + r.x2) / 2, (s.y1 + s.y2) / 2 - (r.y1 + r.y2) / 2)) < (r.thicknessFeet + 0.5) / fpu && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * fpu > 0.5 * r.lengthFeet);
          const filled = near.length > 0;
          if (filled) { if (junk.get(r)) filledJunk += r.lengthFeet; else filledReal += r.lengthFeet; }
          else { if (junk.get(r)) outlineJunk += r.lengthFeet; else outlineReal += r.lengthFeet; }
        }

        // Plan comparison against the paired demolition plan, as the parked branch drove it.
        const liveFeet = runs.reduce((n, w) => n + w.lengthFeet, 0);
        const doc2 = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const setPairs = pairsBySet.get(dir) ?? (await pairsForSet(doc2, fpu));
        pairsBySet.set(dir, setPairs);
        let compared: WallCandidate[] = [];
        let demoPair: string | null = null;
        let best = 0;
        const myFaces = longFaces(strokes.segments, W, fpu);
        for (const pair of setPairs.filter((p) => p.newPage === saved.page)) {
          const st = await doc2.pageStrokes(pair.demoPage);
          if (st.segments.length < 100) continue;
          try {
            const its = (await doc2.pageText(pair.demoPage)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
            const fpOther = (fpu * st.widthPt) / W;
            const faces = longFaces(st.segments, st.widthPt, fpOther);
            const paired = findWallsOnSheet({ segments: st.segments, textItems: its, pageSize: { widthPt: st.widthPt, heightPt: st.heightPt }, feetPerUnit: fpOther, wallTypes: [], sampledSheets: null }).walls;
            const remove = demoRuns(st.segments, st.widthPt, fpOther, its);
            const onRemoved = (l: Line) => remove.some((r) => onPriorPlan({ ...r, thicknessFeet: 0.5 }, [{ ...l, thicknessFeet: 0.5 }], fpu) || onPriorPlan({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, thicknessFeet: r.thicknessIn / 12 }, [{ ...r, thicknessFeet: r.thicknessIn / 12 }], fpu));
            const remain = paired.filter((w) => !onRemoved(w));
            const few = remain.reduce((n, w) => n + w.lengthFeet, 0) < FEW_WALLS_SHARE * liveFeet;
            const set = existingWallSet({ level: null, remove, remain, newPlan: runs, feetPerUnit: fpu });
            const shift = !few && set.shift !== null ? set.shift : alignViews(myFaces, faces, fpu);
            if (shift === null || shift.votes < MIN_VOTES) continue;
            const lines: PriorLine[] = few ? faces.filter((f) => !onRemoved(f)) : remain.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet }));
            const aligned = lines.map((p) => ({ ...p, x1: p.x1 + shift.dx, y1: p.y1 + shift.dy, x2: p.x2 + shift.dx, y2: p.y2 + shift.dy }));
            const on = runs.filter((w) => onPriorPlan(w, aligned, fpu));
            const feet = on.reduce((n, w) => n + w.lengthFeet, 0);
            if (feet > best) { best = feet; compared = on; demoPair = `p${pair.demoPage} by ${pair.basis}, ${few ? "faces" : "walls"}, ${shift.votes} votes`; }
          } catch { /* a page too dense to detect is not a prior plan */ }
        }
        await doc2.close();
        await doc.close();

        const dump = (process.env.RENO_DUMP ?? "").split(",").filter(Boolean);
        if (!HELD && dump.some((d) => dir.includes(d))) {
          for (const r of compared) console.log(`  CMP ${dir.slice(0, 14)}/${sheet} ${demoPair} ${junk.get(r) ? "junk" : "REAL"} ${r.lengthFeet.toFixed(1)}ft ${(r.thicknessFeet * 12).toFixed(1)}in ${r.x1.toFixed(4)},${r.y1.toFixed(4)},${r.x2.toFixed(4)},${r.y2.toFixed(4)}`);
        }
        const arm = (aside: readonly WallCandidate[]): Arm => {
          const s = new Set(aside);
          let real = 0, j = 0;
          for (const r of s) { if (junk.get(r)) j += r.lengthFeet; else real += r.lengthFeet; }
          return { real, junk: j, posted: posted(s) };
        };
        rows.push({ set: dir, sheet, renovation, legend, demoPair, twoPens: penned.length > 0, filledReal, filledJunk, outlineReal, outlineJunk, key: keyFeet, posted: posted(new Set()), rules: { pens: arm(penned), compare: arm(compared) } });
      }
    }
    expect(rows.length, "no labelled sheet was read").toBeGreaterThan(0);
    const lines: string[] = [];
    const f = (n: number) => n.toFixed(0);
    const pct = (p: number, k: number) => `${p >= k ? "+" : ""}${((100 * (p - k)) / k).toFixed(1)}%`;
    if (!HELD) {
      lines.push("PER SHEET — conventions, and what each parked rule sets aside (real/junk ft) and posted before → after");
      for (const r of rows) {
        lines.push(`${r.renovation ? "RENO" : "NEW "} ${r.set.slice(0, 28).padEnd(28)} ${r.sheet.padEnd(8)} key ${f(r.key).padStart(6)} posted ${f(r.posted).padStart(6)} | legend ${r.legend ? "Y" : "-"} demo ${r.demoPair ?? "-"} twoPens ${r.twoPens ? "Y" : "-"} | filled real/junk ${f(r.filledReal)}/${f(r.filledJunk)} outline ${f(r.outlineReal)}/${f(r.outlineJunk)} | pens ${f(r.rules.pens.real)}/${f(r.rules.pens.junk)} compare ${f(r.rules.compare.real)}/${f(r.rules.compare.junk)}`);
      }
      lines.push("", "PER BUILDING (real lost / junk removed, posted before → after)");
      for (const set of [...new Set(rows.map((r) => r.set))]) {
        const rs = rows.filter((r) => r.set === set);
        const t = (rule: Rule) => `${f(rs.reduce((n, r) => n + r.rules[rule].real, 0))}/${f(rs.reduce((n, r) => n + r.rules[rule].junk, 0))}`;
        lines.push(`  ${set.slice(0, 40).padEnd(40)} pens ${t("pens").padStart(10)}   compare ${t("compare").padStart(10)}`);
      }
    }
    for (const group of ["renovation", "new build", "all"] as const) {
      const rs = rows.filter((r) => group === "all" || r.renovation === (group === "renovation"));
      if (rs.length === 0) continue;
      const key = rs.reduce((n, r) => n + r.key, 0), base = rs.reduce((n, r) => n + r.posted, 0);
      const tot = (rule: Rule) => {
        const real = rs.reduce((n, r) => n + r.rules[rule].real, 0), junk = rs.reduce((n, r) => n + r.rules[rule].junk, 0), after = rs.reduce((n, r) => n + r.rules[rule].posted, 0);
        return `${rule}: real lost ${f(real)} / junk removed ${f(junk)} (${real > 0 ? (junk / real).toFixed(1) : "∞"}:1), posted ${pct(after, key)}`;
      };
      lines.push(`${HELD ? "HELD-OUT" : "TRAINING"} ${group}: sheets ${rs.length}, key ${f(key)}, posted ${pct(base, key)} | ${tot("pens")} | ${tot("compare")}`);
    }
    writeFileSync(OUT, lines.join("\n") + "\n");
  });
});
