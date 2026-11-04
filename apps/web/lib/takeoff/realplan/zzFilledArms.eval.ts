import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { inPageWidthUnits } from "../findWallsOnSheet";
import { heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, totalScore, type SheetScore } from "../heldOutScore";
import { coveredLength, filledBands, filledWallCandidates } from "../filledWalls";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { pagesToSample } from "../sheetTemplate";
import { sheetStrokes } from "../sheetStrokes";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── FILLED BANDS OFF AGAINST ON, PER BUILDING ──
 *
 * The app's own list (`detectForSheet` then `offeredCandidates`) on every
 * labelled sheet, scored against its answer key twice. `ARMS_HELD=1` scores
 * the held-out buildings instead and prints TOTALS ONLY — no set, no sheet.
 *
 *   ARMS_LABELS=… ARMS_PLANS=… ARMS_OUT=… npx vitest run --config vitest.eval.config.mts \
 *     lib/takeoff/realplan/zzFilledArms.eval.ts
 */
const LABELS = process.env.ARMS_LABELS ?? "";
const PLANS = process.env.ARMS_PLANS ?? "";
const OUT = process.env.ARMS_OUT ?? "";
const HELD = process.env.ARMS_HELD === "1";
const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
function pdfFor(dir: string): string | undefined {
  for (const base of [PLANS, join(PLANS, "new")]) {
    if (!existsSync(base)) continue;
    const hit = readdirSync(base).find((n) => n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir));
    if (hit !== undefined) return join(base, hit);
  }
  return undefined;
}

type Label = Parameters<typeof keyFromLabels>[0] & { page: number; feetPerUnit: number };

describe.skipIf(LABELS === "" || PLANS === "" || OUT === "")("filled bands, off and on", () => {
  it("scores both arms on every labelled sheet", { timeout: 7_200_000 }, async () => {
    const arms: Record<"off" | "on", SheetScore[]> = { off: [], on: [] };
    const lines: string[] = [];
    let unscored = 0;
    let sheetsWithBands = 0;
    for (const dir of readdirSync(LABELS).sort()) {
      if ((heldOutReason(dir) !== null) !== HELD) continue;
      const pdf = pdfFor(dir);
      if (pdf === undefined) {
        unscored += 1;
        continue;
      }
      for (const name of readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json"))) {
        const lab = JSON.parse(readFileSync(join(LABELS, dir, name), "utf8")) as Label;
        const { key, fromTracedFeet } = keyFromLabels(lab, lab.feetPerUnit);
        if (key.length === 0) continue;
        const read = await sheetStrokes(Buffer.from(readFileSync(pdf)), lab.page);
        const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
        const words = (await doc.pageText(lab.page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const sampled: StrokeSegment[][] = [];
        for (const n of pagesToSample(doc.pageCount, lab.page)) {
          const other = n === lab.page ? read : await sheetStrokes(Buffer.from(readFileSync(pdf)), n);
          sampled.push(other.segments.map(inPageWidthUnits(other.widthPt || read.widthPt)));
        }
        const judged = lab.verdicts.filter((v) => v.verdict === "not-wall");
        const row: string[] = [dir.slice(0, 28), name.slice(0, -5)];
        const byArm: Record<string, { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessIn: number | null }[]> = {};
        const bandRuns: { x1: number; y1: number; x2: number; y2: number }[] = [];
        for (const arm of ["off", "on"] as const) {
          const det = detectForSheet({ segments: read.segments, textItems: words, pageSize: { widthPt: read.widthPt, heightPt: read.heightPt }, feetPerUnit: lab.feetPerUnit, sampledSheets: sampled, scanned: false, filledBands: arm === "on" ? undefined : false });
          const offered = offeredCandidates({
            walls: det.found.walls,
            segments: det.found.inUnits.map((s) => ({ ...s, x1: s.x1 * read.widthPt, y1: s.y1 * read.widthPt, x2: s.x2 * read.widthPt, y2: s.y2 * read.widthPt })),
            widthPt: read.widthPt,
            feetPerUnit: lab.feetPerUnit,
            planBoxes: det.planBoxes,
            textItems: words,
            pageSegments: read.segments,
          });
          const s = scoreSheet({
            set: dir,
            sheet: name,
            key,
            proposed: offered.candidates.map((w) => ({ ...w, thicknessFeet: w.thicknessIn === null ? undefined : w.thicknessIn / 12 })),
            judged,
            feetPerUnit: lab.feetPerUnit,
            keyFromTracedFeet: fromTracedFeet,
          });
          arms[arm].push(s);
          if (arm === "off") {
            const all = filledBands(det.found.inUnits, lab.feetPerUnit).reduce((t, b) => t + b.lengthFeet, 0);
            const left = filledWallCandidates(det.found.inUnits, lab.feetPerUnit, det.found.everywhere, undefined, 0).reduce((t, b) => t + b.lengthFeet, 0);
            row.push(`bands ${all.toFixed(0)} uncovered ${left.toFixed(0)}`);
          }
          byArm[arm] = offered.candidates;
          if (arm === "on") bandRuns.push(...offered.offeredRuns.filter((w) => w.fromFill === true));
          if (arm === "on" && offered.offeredRuns.some((w) => w.fromFill === true)) sheetsWithBands += 1;
          row.push(`${arm} miss ${s.missingFeet.toFixed(0)} junk ${s.confirmedJunkFeet.toFixed(0)} unjudged ${s.unjudgedFeet.toFixed(0)}`);
        }
        if (!HELD) lines.push(row.join("\t"));
        if (!HELD && process.env.ARMS_DUMP === "1") {
          const fpu = lab.feetPerUnit;
          for (const c of byArm.on!) {
            if (coveredLength(c, byArm.off!, 0.5 / fpu) > 0.5 * Math.hypot(c.x2 - c.x1, c.y2 - c.y1)) continue;
            const L = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
            const k = coveredLength(c, key, 1.5 / fpu) / L;
            const j = coveredLength(c, judged, 1.5 / fpu) / L;
            const band = coveredLength(c, bandRuns, 0.2 / fpu) > 0.5 * L ? "BAND" : "KNOCK-ON";
            lines.push(`  ${band} ${c.lengthFeet.toFixed(1)}ft ${c.thicknessIn?.toFixed(1)}in key ${k.toFixed(2)} junk ${j.toFixed(2)} at ${c.x1.toFixed(4)},${c.y1.toFixed(4)} ${c.x2.toFixed(4)},${c.y2.toFixed(4)}`);
          }
        }
      }
    }
    const t = (a: SheetScore[]) => {
      const x = totalScore(a);
      return `sheets ${x.sheets} key ${x.keyFeet.toFixed(0)} proposed ${x.proposedFeet.toFixed(0)} missing ${x.missingFeet.toFixed(0)} junk ${x.confirmedJunkFeet.toFixed(0)} unjudged ${x.unjudgedFeet.toFixed(0)} net ${x.netFeet.toFixed(0)}`;
    };
    if (!HELD) {
      lines.push("", "PER BUILDING  (off → on)");
      for (const set of [...new Set(arms.off.map((s) => s.set))]) {
        lines.push(`${set.slice(0, 40)}\n  off ${t(arms.off.filter((s) => s.set === set))}\n  on  ${t(arms.on.filter((s) => s.set === set))}`);
      }
    }
    lines.push("", `${HELD ? "HELD-OUT" : "TRAINING"} TOTAL${unscored > 0 ? ` (${unscored} label folder(s) had no pdf)` : ""} · sheets offered a band: ${sheetsWithBands}`, `  off ${t(arms.off)}`, `  on  ${t(arms.on)}`);
    writeFileSync(OUT, lines.join("\n") + "\n");
  });
});
