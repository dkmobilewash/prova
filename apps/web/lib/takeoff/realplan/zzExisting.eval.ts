import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { AREA_LABEL, isExistingRoomName, isWallTag, LEGEND_EXISTING, legendPens, modalWallPen, textRows } from "../existingWalls";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── WHAT THE `existing` SET-ASIDE TAKES, AGAINST THE LABELS ──
 *
 * For every labelled sheet: the runs `existingWalls.ts` set aside, by route
 * (tag / area / legend), in feet, and what the label file says about each —
 * real (accepted or traced wall covers it), junk (rejected covers it) or
 * unverdicted. Training sheets print one row each; held-out sheets are
 * summed into ONE row and never named, which is the only way they may be
 * read. A route that takes real wall on a training sheet is the number to
 * argue with; against keys that still hold existing walls it will, which is
 * why this waits for the key cleanup before it is believed.
 *
 *   EX_SHEETS="bunkie/A100,murray/A101"   (optional; default every sheet)
 *   EX_DUMP=1                              print each set-aside run's reason
 *   EX_WORDS=1                             print each training sheet's rows that match a route's words,
 *                                          and the rows that say EXIST / NIC / TO REMAIN and match none
 */
const MARKER = /EXIST|\bN\.?I\.?C\b|TO\s+REMAIN|NOT\s+IN\s+CONTRACT|\(E\)/i;
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
type Tally = { n: number; real: number; junk: number; other: number };
const fresh = (): Tally => ({ n: 0, real: 0, junk: 0, other: 0 });
const ROUTES = ["tag", "area", "legend"] as const;
const routeOf = (why: string): (typeof ROUTES)[number] => (why.startsWith("tagged") ? "tag" : why.startsWith("bounds only") ? "area" : "legend");

describe.skipIf(DIR === "" || LABELS === "")("the existing set-aside, against the labels", () => {
  it("tallies what it takes, by route, per training sheet and as one held-out total", { timeout: 7_200_000 }, async () => {
    const found: string[] = [];
    const rows: { name: string; byRoute: Record<string, Tally>; offered: number }[] = [];
    const heldOut = { name: "HELD-OUT (totals, sheets not named)", byRoute: Object.fromEntries(ROUTES.map((r) => [r, fresh()])) as Record<string, Tally>, offered: 0 };
    let heldOutSheets = 0;
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
        if (process.env.EX_WORDS === "1" && !held) {
          const nearestFeet = (r: { x: number; y: number; width: number; height: number }) => {
            const px = (r.x + r.width / 2) / W, py = (r.y - r.height / 2) / W;
            let best = Infinity;
            for (const w of d.found.walls) { const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l2 = dx * dx + dy * dy || 1e-12; const t = Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / l2)); best = Math.min(best, Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy))); }
            return best * fpu;
          };
          for (const r of textRows(textItems)) {
            const hit = [isWallTag(r.str) ? "TAG" : "", AREA_LABEL.test(r.str) ? "AREA" : "", isExistingRoomName(r.str) ? "ROOM" : "", LEGEND_EXISTING.test(r.str) ? "LEGEND" : ""].filter((h) => h !== "").join("+");
            if (hit !== "") console.log(`    WORDS ${dir.slice(0, 14)}/${sheet} ${hit} (nearest run ${nearestFeet(r).toFixed(1)} ft): ${r.str.slice(0, 80)}`);
            if (hit.includes("LEGEND")) {
              // Where the sample would be: strokes within eight text heights left and right of the row.
              const h = r.height / W, cy = (r.y - r.height / 2) / W, x0 = r.x / W, x1 = (r.x + r.width) / W;
              const units = d.found.inUnits;
              const inBand = (s: { y1: number; y2: number }) => Math.abs(s.y1 - cy) <= h && Math.abs(s.y2 - cy) <= h;
              const left = units.filter((s) => inBand(s) && s.x1 >= x0 - 8 * h && s.x1 <= x0 && s.x2 >= x0 - 8 * h && s.x2 <= x0);
              const right = units.filter((s) => inBand(s) && s.x1 >= x1 && s.x1 <= x1 + 8 * h && s.x2 >= x1 && s.x2 <= x1 + 8 * h);
              const pens = (list: typeof units) => [...new Set(list.map((s) => `g${(s.gray ?? 0).toFixed(2)}${s.fill === undefined ? "" : `/f${s.fill.toFixed(2)}`}/w${(s.width ?? 0).toFixed(2)}/${(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / h).toFixed(1)}h`))].slice(0, 6).join(" ");
              const raw = strokes.segments.map((o) => ({ ...o, x1: o.x1 / W, y1: o.y1 / W, x2: o.x2 / W, y2: o.y2 / W }));
              const rawLeft = raw.filter((o) => inBand(o) && o.x1 >= x0 - 8 * h && o.x1 <= x0 && o.x2 >= x0 - 8 * h && o.x2 <= x0);
              console.log(`    LEGENDROW ${sheet} at ${x0.toFixed(4)},${cy.toFixed(4)} h ${h.toFixed(4)}: left ${left.length} [${pens(left)}] right ${right.length} [${pens(right)}] RAW left ${rawLeft.length} [${pens(rawLeft)}]`);
              {
                const cx1 = x0 - 0.2 * h, cx0 = cx1 - 8 * h;
                const inside = (x: number, y: number) => x >= cx0 && x <= cx1 && Math.abs(y - cy) <= h;
                const sw = raw.filter((o) => inside(o.x1, o.y1) && inside(o.x2, o.y2));
                const horiz = (o: { x1: number; y1: number; x2: number; y2: number }) => Math.abs(o.y2 - o.y1) <= 0.1 * Math.abs(o.x2 - o.x1);
                const vert = (o: { x1: number; y1: number; x2: number; y2: number }) => Math.abs(o.x2 - o.x1) <= 0.1 * Math.abs(o.y2 - o.y1);
                console.log(`    LEGENDCHECK ${sheet} "${r.str}": words ${r.str.split(/\s+/).length} swatch ${sw.length} alongRow ${sw.filter((o) => horiz(o) && Math.abs(o.x2 - o.x1) >= h).length} oblique ${sw.filter((o) => !horiz(o) && !vert(o)).length} wide ${sw.filter((o) => o.fill === undefined && (o.width ?? 0) > r.height).length} rowHeightPt ${r.height.toFixed(2)} strokes ${sw.map((o) => `y${((o.y1 - cy) / h).toFixed(2)}..${((o.y2 - cy) / h).toFixed(2)} x${((o.x1 - x0) / h).toFixed(1)}..${((o.x2 - x0) / h).toFixed(1)} w${(o.width ?? 0).toFixed(2)}${o.fill === undefined ? "" : ` f${o.fill.toFixed(2)}`}`).join(" | ")}`);
              }
              const read = legendPens(textRows(textItems), raw, W);
              console.log(`    LEGENDPENS ${sheet}: existing ${JSON.stringify(read.existing)} fresh ${JSON.stringify(read.fresh)} modal ${JSON.stringify(modalWallPen(d.found.walls, units, fpu))}`);
            }
            else if (MARKER.test(r.str)) console.log(`    WORDS ${dir.slice(0, 14)}/${sheet} unmatched: ${r.str.slice(0, 80)}`);
          }
        }
        const offered = offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W })), widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems, pageSegments: strokes.segments });
        const toRun = (v: Verdict) => ({ ...v, th: v.thicknessFeet ?? 0 });
        const real = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced").map(toRun);
        const rejected = saved.verdicts.filter((v) => v.verdict === "not-wall").map(toRun);
        const row = held ? heldOut : { name: `${dir.slice(0, 24)}/${sheet}`, byRoute: Object.fromEntries(ROUTES.map((r) => [r, fresh()])) as Record<string, Tally>, offered: 0 };
        row.offered += offered.candidates.length;
        if (held) heldOutSheets += 1;
        for (const l of offered.setAsideLines) {
          if (l.kind !== "existing") continue;
          const L = l.lengthFeet;
          const me = { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, th: 0 };
          const realC = coveredFeet(me, real, fpu), rej = coveredFeet(me, rejected, fpu);
          const st: "real" | "junk" | "other" = realC >= 0.5 * L ? "real" : rej >= 0.5 * L ? "junk" : "other";
          const t = row.byRoute[routeOf(l.why)];
          t.n += 1; t[st] += L;
          if (process.env.EX_DUMP === "1" && !held) console.log(`    DUMP ${sheet} ${st} ${L.toFixed(0)}ft ${l.why} at ${l.x1.toFixed(4)},${l.y1.toFixed(4)} -> ${l.x2.toFixed(4)},${l.y2.toFixed(4)}`);
        }
        if (!held) {
          rows.push(row);
          const sentence = offered.setAside.find((a) => a.kind === "existing");
          if (sentence !== undefined) console.log(`    ${row.name}: ${sentence.why}`);
        }
      }
    }
    const total: Record<string, Tally> = Object.fromEntries(ROUTES.map((r) => [r, fresh()]));
    const show = (row: { name: string; byRoute: Record<string, Tally> }) => {
      const cells = ROUTES.map((r) => { const t = row.byRoute[r]; return `${r} n ${String(t.n).padStart(3)} real ${t.real.toFixed(0).padStart(5)} junk ${t.junk.toFixed(0).padStart(5)} unv ${t.other.toFixed(0).padStart(5)}`; });
      console.log(`    ${row.name.padEnd(34)} ${cells.join(" · ")}`);
    };
    console.log("\n  TRAINING, per sheet (only sheets where a route fired):");
    for (const row of rows) {
      if (ROUTES.every((r) => row.byRoute[r].n === 0)) continue;
      show(row);
      for (const r of ROUTES) { total[r].n += row.byRoute[r].n; total[r].real += row.byRoute[r].real; total[r].junk += row.byRoute[r].junk; total[r].other += row.byRoute[r].other; }
    }
    show({ name: `TRAINING total (${rows.length} sheets)`, byRoute: total });
    if (heldOutSheets > 0) show({ ...heldOut, name: `${heldOut.name} (${heldOutSheets})` });
    expect(found.length, "no labelled sheet was read").toBeGreaterThan(0);
  });
});
