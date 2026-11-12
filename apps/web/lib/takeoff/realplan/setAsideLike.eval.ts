import { Buffer } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import { wallsLikeThese, type Line } from "../userExclusions";
import type { WallCandidate } from "../wallVectors";

/**
 * ── PRESSES TO CLEAN A RENOVATION SHEET, BEFORE AND AFTER "SET ASIDE ALL WALLS DRAWN LIKE THIS ONE" ──
 *
 * On the product's offered walls for each sheet (`detectForSheet` + `offeredCandidates`, plan
 * comparison off), the labels play the person, as `zzUserAssist.eval.ts` does: a run the key
 * rejects is junk (there is no "existing" label; on a renovation sheet the rejected runs are the
 * existing walls and the rest of the drawing's noise), one it accepts or traced is real.
 *
 *   BEFORE — the queue today: one press to open the walls review, then one press (D) per junk run.
 *   AFTER  — one press on the queue's "Set aside all walls drawn like this one"; then the person
 *            picks the longest junk run not yet tried (a click) and reads the preview: Enter keeps it
 *            when it adds more junk than real feet, a different click replaces it otherwise; at most
 *            ten picks kept. Then one press (D) per junk run still left. Real walls the picks took are
 *            reported in feet, never hidden.
 *
 *     SA_SHEETS="<pdf>|<page>|<label.json>;…"  REAL_PLAN_DIR=<dir>
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/setAsideLike.eval.ts
 *
 * Calls no model. Prints counts, feet and the first pick's midpoint (page-width units) for the spec.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SHEETS = (process.env.SA_SHEETS ?? "").split(";").filter((s) => s.trim() !== "");
const PICK_CAP = 10;

type G = { x1: number; y1: number; x2: number; y2: number };
type Verdict = G & { lengthFeet: number; thicknessFeet?: number; verdict: string };
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

describe.skipIf(DIR === "" || SHEETS.length === 0)("presses to clean a renovation sheet", () => {
  it("before and after the one-step set-aside", { timeout: 3_600_000 }, async () => {
    const lines: string[] = [];
    for (const spec of SHEETS) {
      const [file, pageText, labelPath] = spec.split("|") as [string, string, string];
      const pdf = readdirSync(DIR).includes(file) ? join(DIR, file) : file;
      const page = Number(pageText);
      const saved = JSON.parse(readFileSync(labelPath, "utf8")) as { feetPerUnit: number; verdicts: Verdict[] };
      const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), page);
      if (strokes === null) continue;
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(page);
      await doc.close();
      const W = strokes.widthPt;
      const fpu = saved.feetPerUnit;
      const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const d = detectForSheet({ segments: strokes.segments, textItems, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu });
      const units = d.found.inUnits;
      const offered = offeredCandidates({ walls: d.found.walls, segments: units.map((one) => ({ ...one, x1: one.x1 * W, y1: one.y1 * W, x2: one.x2 * W, y2: one.y2 * W })), pageSegments: strokes.segments, widthPt: W, feetPerUnit: fpu, planBoxes: d.planBoxes, textItems });
      const toRun = (v: Verdict) => ({ ...v, th: v.thicknessFeet ?? 0 });
      const real = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced").map(toRun);
      const rejected = saved.verdicts.filter((v) => v.verdict === "not-wall").map(toRun);
      const runs = offered.offeredRuns;
      const kind = new Map(
        runs.map((w) => {
          const me = { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, th: w.thicknessFeet };
          return [w, coveredFeet(me, real, fpu) >= 0.5 * w.lengthFeet ? "real" : coveredFeet(me, rejected, fpu) >= 0.5 * w.lengthFeet ? "junk" : "other"] as const;
        }),
      );
      const junk = runs.filter((w) => kind.get(w) === "junk");
      const feet = (ws: Iterable<WallCandidate>, k: string) => [...ws].filter((w) => kind.get(w) === k).reduce((n, w) => n + w.lengthFeet, 0);

      // BEFORE: open the review, one D per junk run.
      const before = 1 + junk.length;

      // AFTER: the queue's button, then picks read off the preview.
      const kept: Line[] = [];
      const tried = new Set<WallCandidate>();
      let aside = new Set<WallCandidate>();
      let presses = 1;
      let firstPick: { x: number; y: number; n: number; feet: number } | null = null;
      while (kept.length < PICK_CAP) {
        const next = junk.filter((w) => !aside.has(w) && !tried.has(w)).sort((a, b) => b.lengthFeet - a.lengthFeet)[0];
        if (next === undefined) break;
        tried.add(next);
        presses += 1; // the click on the wall
        const pick = { x1: next.x1, y1: next.y1, x2: next.x2, y2: next.y2 };
        // The preview is this pick alone (`likeOnSheet`), on what is still on screen.
        const like = wallsLikeThese([pick], runs.filter((w) => !aside.has(w)), units, fpu).excluded;
        if (feet(like, "junk") > feet(like, "real")) {
          presses += 1; // Enter
          kept.push(pick);
          if (firstPick === null) firstPick = { x: (next.x1 + next.x2) / 2, y: (next.y1 + next.y2) / 2, n: like.size, feet: [...like].reduce((n, w) => n + w.lengthFeet, 0) };
          aside = new Set([...aside, ...like]);
        }
      }
      const leftJunk = junk.filter((w) => !aside.has(w)).length;
      const after = presses + leftJunk;
      lines.push(
        `SHEET ${file} p${page}: offered ${runs.length} runs (${junk.length} junk / ${feet(runs, "junk").toFixed(0)} ft, ${runs.filter((w) => kind.get(w) === "real").length} real / ${feet(runs, "real").toFixed(0)} ft)` +
          ` · BEFORE ${before} presses · AFTER ${after} presses (${presses} for ${kept.length} kept of ${tried.size} picks, + ${leftJunk} junk left one by one)` +
          ` · set aside ${feet(aside, "junk").toFixed(0)} ft junk, ${feet(aside, "real").toFixed(0)} ft real lost` +
          (firstPick === null ? "" : ` · first pick at (${firstPick.x.toFixed(4)}, ${firstPick.y.toFixed(4)}): ${firstPick.n} walls, ${firstPick.feet.toFixed(0)} ft`),
      );
    }
    for (const l of lines) console.log(l);
    const measured = lines.filter((l) => l.startsWith("SHEET "));
    expect(measured.length, "no sheet was measured").toBeGreaterThan(0);
  });
});
