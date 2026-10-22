import { Buffer } from "node:buffer";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { duplicatePairs } from "../duplicateCandidates";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import type { Candidate } from "../answerKeyReview";

/**
 * ── HOW MANY PRE-MARKS THE NEW DUPLICATE RULE CHANGES ──
 *
 * Nothing is written. This re-runs the duplicate finder over every labelled
 * sheet both ways — keeping the LONGER twin, as it did, and keeping the
 * better-SUPPORTED twin, as it does now — and counts the pairs whose keeper
 * swaps.
 *
 * Asked for before re-saving anything, which is the right order: a rule
 * change that silently rewrote a hundred verdicts would be indistinguishable
 * from a rule change that fixed two.
 *
 *     DATABASE_URL=…local… REAL_PLAN_DIR=… TAKEOFF_LABEL_DIR=… \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzDupChange.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";

type Saved = {
  set: string;
  sheet: string;
  page: number;
  feetPerUnit: number;
  verdicts?: { x1: number; y1: number; x2: number; y2: number; verdict: string }[];
};

/** Every label file on this machine, with the PDF it came from. */
function labelFiles(): { path: string; dir: string }[] {
  if (!existsSync(LABELS)) return [];
  const out: { path: string; dir: string }[] = [];
  for (const dir of readdirSync(LABELS)) {
    const full = join(LABELS, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const name of readdirSync(full)) {
      if (name.endsWith(".json")) out.push({ path: join(full, name), dir });
    }
  }
  return out;
}

describe.skipIf(DIR === "" || LABELS === "")("what the duplicate fix changes", () => {
  it("counts the pre-marks that swap, across every labelled sheet", { timeout: 7_200_000 }, async () => {
    const files = labelFiles();
    expect(files.length, "no label file was found — check TAKEOFF_LABEL_DIR").toBeGreaterThan(0);

    // The PDF behind each label directory, by matching the plan's own file
    // name — the directory is that name with its punctuation replaced.
    const plans = await prisma.takeoffPlan.findMany({
      select: { fileName: true, fileUrl: true },
    });
    const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();
    const pdfFor = (dir: string) =>
      plans.find((p) => flat(p.fileName ?? "") === flat(dir))?.fileUrl?.replace(/^local:/, "") ??
      null;

    const lines: string[] = [];
    let swapped = 0;
    let pairsSeen = 0;
    let sheetsRead = 0;

    for (const file of files) {
      const saved = JSON.parse(readFileSync(file.path, "utf8")) as Saved;
      const pdf = pdfFor(file.dir);
      if (pdf === null || !existsSync(join(DIR, pdf))) {
        lines.push(`  ${file.dir.slice(0, 34).padEnd(34)} ${saved.sheet.padEnd(8)} NO PDF`);
        continue;
      }
      const read = await sheetStrokes(Buffer.from(readFileSync(join(DIR, pdf))), saved.page);
      if (read === null) continue;
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, pdf))));
      const text = await doc.pageText(saved.page);
      const W = read.widthPt;
      const found = findWallsOnSheet({
        segments: read.segments,
        textItems: text.items.map((i) => ({
          str: i.str,
          x: i.x,
          y: i.y,
          width: i.width,
          height: i.height,
        })),
        pageSize: { widthPt: W, heightPt: read.heightPt },
        feetPerUnit: saved.feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });
      sheetsRead += 1;

      const candidates: Candidate[] = found.walls.map((wall, at) => ({
        id: `w${at}`,
        x1: wall.x1,
        y1: wall.y1,
        x2: wall.x2,
        y2: wall.y2,
        lengthFeet: wall.lengthFeet,
        thicknessIn: wall.thicknessFeet * 12,
        from: "pair",
        note: "detected",
      }));
      const inUnits = read.segments.map((s) => ({
        ...s,
        x1: s.x1 / W,
        y1: s.y1 / W,
        x2: s.x2 / W,
        y2: s.y2 / W,
      }));

      const before = duplicatePairs(candidates, saved.feetPerUnit);
      const after = duplicatePairs(candidates, saved.feetPerUnit, inUnits);
      const beforeKeep = new Map(before.map((p) => [`${p.keep}|${p.drop}`, p]));
      // A swap is the same two candidates with the keeper and the dropped
      // exchanged — not a pair that merely appeared or vanished.
      let swapsHere = 0;
      for (const pair of after) {
        if (beforeKeep.has(`${pair.drop}|${pair.keep}`)) swapsHere += 1;
      }
      swapped += swapsHere;
      pairsSeen += after.length;
      lines.push(
        `  ${file.dir.slice(0, 34).padEnd(34)} ${saved.sheet.padEnd(8)}` +
          `${String(before.length).padStart(4)} pairs ->${String(after.length).padStart(4)}` +
          `   ${swapsHere > 0 ? `${swapsHere} SWAPPED` : "none swapped"}`,
      );
      for (const pair of after.slice(0, 40)) {
        if (!beforeKeep.has(`${pair.drop}|${pair.keep}`)) continue;
        const keep = candidates.find((c) => c.id === pair.keep);
        const drop = candidates.find((c) => c.id === pair.drop);
        lines.push(
          `      now keeps ${keep?.lengthFeet.toFixed(1)}ft/${keep?.thicknessIn?.toFixed(1)}in` +
            ` (support ${pair.support?.keep.toFixed(2)})` +
            `  over ${drop?.lengthFeet.toFixed(1)}ft/${drop?.thicknessIn?.toFixed(1)}in` +
            ` (support ${pair.support?.drop.toFixed(2)})`,
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n${sheetsRead} sheets read, ${pairsSeen} duplicate pairs, ` +
        `${swapped} pre-marks swap with the fix\n${lines.join("\n")}`,
    );
    expect(sheetsRead, "no sheet could be re-measured, so this compares nothing").toBeGreaterThan(0);
    expect(pairsSeen, "no duplicate pair was found on any sheet").toBeGreaterThan(0);
  });
});
