import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { inPageWidthUnits } from "../findWallsOnSheet";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import { pagesToSample } from "../sheetTemplate";
import { feetPerPageWidth } from "../../takeoff-plan";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── THE SAME LIST, COMPUTED IN NODE, AGAINST WHAT THE APP SHOWED ──
 *
 * `e2e/specs/takeoff-app-equals-eval.spec.ts` writes `app-counts.json` with
 * the candidate count the answer-key panel drew on each sheet at a scale set
 * to exactly 288 ft per page width. This runs `detectForSheet` +
 * `offeredCandidates` on the same PDF, page, scale and template sample, and
 * prints both counts side by side. Equal is the proof that app and evals are
 * one pipeline; unequal names the sheet to look at.
 *
 *     REAL_PLAN_DIR=… APP_EQ_OUT=… npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/zzAppEquals.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.APP_EQ_OUT ?? "";

type AppRow = {
  set: string;
  file: string;
  page: number;
  keyLines: number;
  runsText?: string;
  caution: string;
  feetPerUnit: number;
  /** The line the app stored, read off its own form: feet per page width is derived from it exactly as the viewer does. */
  calibration?: { points: string; declaredDistanceFeet: string };
};

function appFeetPerUnit(row: AppRow): number {
  if (row.calibration === undefined) return row.feetPerUnit;
  const points = JSON.parse(row.calibration.points) as { xs: number[]; ys: number[] };
  const feet = Number(row.calibration.declaredDistanceFeet.replace(/[^\d.]/g, ""));
  return feetPerPageWidth({ x1: points.xs[0], y1: points.ys[0], x2: points.xs[1], y2: points.ys[1], declaredDistanceFeet: feet }) ?? row.feetPerUnit;
}

describe.skipIf(DIR === "" || OUT === "" || !existsSync(join(OUT, "app-counts.json")))("app = eval", () => {
  it("computes the eval's count for every sheet the app recorded", { timeout: 3_600_000 }, async () => {
    const rows = JSON.parse(readFileSync(join(OUT, "app-counts.json"), "utf8")) as AppRow[];
    expect(rows.length).toBeGreaterThan(0);
    const lines: string[] = [];
    let mismatches = 0;
    for (const row of rows) {
      const file = readdirSync(DIR).find((n) => n === row.file) ?? row.file;
      const pdf = join(DIR, file);
      const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), row.page);
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(row.page);
      // As the viewer's `pageTextItems` has them: blank strings dropped, sizes defaulted to 0.
      const textItems = text.items
        .filter((i) => i.str.trim() !== "")
        .map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width ?? 0, height: i.height ?? 0 }));
      const rawText = text.items.length;
      // The viewer samples other pages for the sheet template, each in ITS OWN width.
      const sampledSheets: StrokeSegment[][] = [];
      // The sheet ITSELF is in the sample, as the viewer has it (`onFindWalls`).
      for (const n of pagesToSample(doc.pageCount, row.page)) {
        const other = n === row.page ? strokes : await sheetStrokes(Buffer.from(readFileSync(pdf)), n);
        sampledSheets.push(other.segments.map(inPageWidthUnits(other.widthPt || strokes.widthPt)));
      }
      await doc.close();
      const feetPerUnit = appFeetPerUnit(row);
      let sum = 0;
      let seq = 2166136261;
      for (const one of strokes.segments) {
        sum += Math.abs(one.x1) + Math.abs(one.y1) + Math.abs(one.x2) + Math.abs(one.y2);
        seq = Math.imul(seq ^ Math.round(one.x1 * 10 + one.y1 * 100 + one.x2 * 1000 + one.y2), 16777619) >>> 0;
      }
      const fnv = (seed: number, value: number) => Math.imul(seed ^ Math.round(value * 1000), 16777619) >>> 0;
      let textHash = 2166136261;
      for (const t of textItems) textHash = fnv(fnv(fnv(fnv(textHash, t.x), t.y), t.height), t.str.length);
      let sampleHash = 2166136261;
      let sampleN = 0;
      for (const sheet of sampledSheets) for (const one of sheet) { sampleHash = fnv(fnv(sampleHash, one.x1 + one.y1), one.x2 + one.y2); sampleN += 1; }
      const digests = `sumAbs ${Math.round(sum)} seq ${seq} text ${textHash} sample ${sampleHash}/${sampleN} page ${strokes.widthPt}x${strokes.heightPt}`;
      // ── THE HOOK IS PART OF THE PIPELINE, AND IT CHANGES THE ANSWER ──
      //
      // Every input matched the app by digest — segments in value AND order,
      // text, the template sample, the page size, the scale — and the counts
      // still differed by 1 to 14, with only the duplicate stage moving.
      // The cause is `wallVectors.ts`'s "classifier seam": with ANY hook set
      // (`onCandidate`, `decide`, `veto`) the pairing pass COLLECTS before it
      // awards, and that changes which pairs win. Answer-key mode sets
      // `onCandidate`, so the list a reviewer labels is the collecting path;
      // a customer's find, with no hook, is the other one. Crosslines A100:
      // 258 walls with the hook, 244 without. Measured 2026-10-22, four
      // sheets, exact on all four once the hook is passed here too.
      const input = {
        segments: strokes.segments,
        textItems,
        pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
        feetPerUnit,
        sampledSheets,
      };
      const detected = detectForSheet({ ...input, onCandidate: () => undefined });
      const customer = detectForSheet(input);
      // The viewer hands the triage the FINDER's segments (`found.inUnits`,
      // scaled back to points), not the raw strokes — `lastDetect.segments`.
      let wallsHash = 2166136261;
      for (const wll of detected.found.walls) wallsHash = fnv(fnv(wallsHash, wll.x1 + wll.y1), wll.x2 + wll.y2);
      const offered = offeredCandidates({
        walls: detected.found.walls,
        segments: detected.found.inUnits.map((one) => ({ ...one, x1: one.x1 * strokes.widthPt, y1: one.y1 * strokes.widthPt, x2: one.x2 * strokes.widthPt, y2: one.y2 * strokes.widthPt })),
        widthPt: strokes.widthPt,
        feetPerUnit,
        planBoxes: detected.planBoxes,
      });
      const same = offered.candidates.length === row.keyLines;
      if (!same) mismatches += 1;
      lines.push(
        `  ${`${row.set} p${row.page}`.padEnd(18)} app ${String(row.keyLines).padStart(4)} · eval ${String(offered.candidates.length).padStart(4)} ${same ? "== SAME" : "!= DIFFERENT"} · at ${feetPerUnit.toFixed(2)} ft/width · runs app ${row.runsText ?? "?"} eval ${detected.found.walls.length} (customer path, no hook: ${customer.found.walls.length}) · template −${detected.found.templateDropped} grid −${detected.found.gridDropped} hatch −${detected.found.hatchDropped} dup −${detected.found.duplicateDropped} layers −${detected.found.layerDropped.length} · segs ${strokes.segments.length} [${digests} walls ${wallsHash}] app saw ${(row as unknown as { seen?: string }).seen ?? ""} · text ${textItems.length}/${rawText} sampled ${sampledSheets.length} · drawings ${detected.views} · kept ${detected.kept.map((k) => k.name).join(" + ") || "(whole sheet)"}`,
      );
    }
    console.log(`\nAPP = EVAL, ${rows.length} sheets, each at the scale the app stored\n` + lines.join("\n") + `\n  ${mismatches === 0 ? "every sheet matches" : `${mismatches} sheet(s) differ`}`);
    expect(mismatches, "the app and the eval disagree on a sheet").toBe(0);
  });
});
