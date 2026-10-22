import { Buffer } from "node:buffer";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { duplicatePairs } from "../duplicateCandidates";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import type { Candidate } from "../answerKeyReview";

/**
 * ── APPLYING THE FOUR CHANGED PRE-MARKS TO THE SAVED LABELS ──
 *
 * `zzDupChange.eval.ts` measured which pre-marks the new duplicate rule
 * changes. This applies those four, and nothing else.
 *
 * ── IT IS A DRY RUN UNTIL IT IS TOLD OTHERWISE ──
 *
 * `RESAVE=1` writes; without it the file is only read and the before/after is
 * printed. A session of mine once overwrote 143 verdicts by pressing Save on a
 * fresh review, so a script that edits somebody's labels prints what it would
 * do first and keeps a `.bak` beside each file it touches.
 *
 * ── AND IT ONLY MOVES A VERDICT THE PRE-MARKING PUT THERE ──
 *
 * The labeller reviewed every candidate on these sheets. Where they corrected
 * a wrong pre-mark themselves the saved verdicts already disagree with it, and
 * overwriting those would be undoing a person's decision with a rule. So a
 * pair is swapped only when the file still holds exactly what the OLD rule
 * wrote — the kept one accepted, the dropped one rejected. Anything else is
 * reported and left alone.
 *
 *     DATABASE_URL=…local… REAL_PLAN_DIR=… TAKEOFF_LABEL_DIR=… [RESAVE=1] \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzDupResave.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const WRITE = process.env.RESAVE === "1";

/** The four sheets `zzDupChange` reported, as <label dir>/<sheet>. */
const SHEETS: ReadonlyArray<readonly [string, string]> = [
  ["E_Street_421-Set.pdf", "A2.1"],
  ["20260424_HPL_Lighthouse_Bulletin_2.pdf", "p3"],
  ["Camp_Bow_Wow_-_100_CD_ARCH_2_1_.pdf", "A120"],
];

type SavedVerdict = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  thicknessFeet: number;
  verdict: string;
};
type Saved = {
  set: string;
  sheet: string;
  page: number;
  feetPerUnit: number;
  counts?: Record<string, number>;
  verdicts: SavedVerdict[];
};

/**
 * How far two readings of the same run may sit apart, in page-width units.
 *
 * Not exact equality. The saved file was written by a finder that has changed
 * since — the view picking, the splitting — so a run recomputed today can be
 * the same wall to the inch and not the same float. A thousandth of the page
 * width is about three inches at these scales, which is far tighter than the
 * gap between a wall and its offset twin and loose enough to survive a
 * re-measure.
 */
const SAME = Number(process.env.SAME_TOLERANCE ?? "0.001");

function sameRun(a: { x1: number; y1: number; x2: number; y2: number }, b: SavedVerdict): boolean {
  // Each endpoint within the tolerance, rather than the four offsets summed:
  // a sum lets one end drift by the whole budget while the other is exact.
  const fwd = Math.max(
    Math.hypot(a.x1 - b.x1, a.y1 - b.y1),
    Math.hypot(a.x2 - b.x2, a.y2 - b.y2),
  );
  const rev = Math.max(
    Math.hypot(a.x1 - b.x2, a.y1 - b.y2),
    Math.hypot(a.x2 - b.x1, a.y2 - b.y1),
  );
  return Math.min(fwd, rev) < SAME;
}

const acceptedFeet = (v: readonly SavedVerdict[]) =>
  v.filter((one) => one.verdict === "wall").reduce((n, one) => n + one.lengthFeet, 0);

describe.skipIf(DIR === "" || LABELS === "")("re-saving the changed pre-marks", () => {
  it(`${WRITE ? "applies" : "would apply"} them, and shows the footage both ways`, { timeout: 7_200_000 }, async () => {
    const plans = await prisma.takeoffPlan.findMany({ select: { fileName: true, fileUrl: true } });
    const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();

    const lines: string[] = [];
    let swapsApplied = 0;
    let sheetsTouched = 0;

    for (const [dir, sheet] of SHEETS) {
      const path = join(LABELS, dir, `${sheet}.json`);
      expect(existsSync(path), `no label file at ${path}`).toBe(true);
      const saved = JSON.parse(readFileSync(path, "utf8")) as Saved;
      const pdf =
        plans.find((p) => flat(p.fileName ?? "") === flat(dir))?.fileUrl?.replace(/^local:/, "") ??
        null;
      expect(pdf, `no ingested plan matches ${dir}`).not.toBeNull();
      if (pdf === null) continue;

      const read = await sheetStrokes(Buffer.from(readFileSync(join(DIR, pdf))), saved.page);
      expect(read, `${sheet}: unreadable`).not.toBeNull();
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
      const oldPairs = new Map(before.map((p) => [`${p.keep}|${p.drop}`, p]));
      const swaps = after.filter((p) => oldPairs.has(`${p.drop}|${p.keep}`));

      const feetBefore = acceptedFeet(saved.verdicts);
      let appliedHere = 0;
      const notes: string[] = [];

      for (const pair of swaps) {
        const nowKeep = candidates.find((c) => c.id === pair.keep);
        const nowDrop = candidates.find((c) => c.id === pair.drop);
        if (nowKeep === undefined || nowDrop === undefined) continue;
        const keepRow = saved.verdicts.find((v) => sameRun(nowKeep, v));
        const dropRow = saved.verdicts.find((v) => sameRun(nowDrop, v));
        if (keepRow === undefined || dropRow === undefined) {
          notes.push(
            `      SKIPPED ${nowKeep.lengthFeet.toFixed(1)}ft/${nowDrop.lengthFeet.toFixed(1)}ft` +
              ` — one of the pair is not in the saved file`,
          );
          continue;
        }
        // Only what the OLD rule wrote: keeper accepted, dropped rejected.
        if (keepRow.verdict !== "not-wall" || dropRow.verdict !== "wall") {
          notes.push(
            `      LEFT ALONE ${nowKeep.lengthFeet.toFixed(1)}ft is "${keepRow.verdict}", ` +
              `${nowDrop.lengthFeet.toFixed(1)}ft is "${dropRow.verdict}" — the reviewer decided this, not the rule`,
          );
          continue;
        }
        keepRow.verdict = "wall";
        dropRow.verdict = "not-wall";
        appliedHere += 1;
        notes.push(
          `      SWAP accept ${nowKeep.lengthFeet.toFixed(1)}ft/${(nowKeep.thicknessIn ?? 0).toFixed(1)}in` +
            ` (support ${pair.support?.keep.toFixed(2)}), reject ` +
            `${nowDrop.lengthFeet.toFixed(1)}ft/${(nowDrop.thicknessIn ?? 0).toFixed(1)}in` +
            ` (support ${pair.support?.drop.toFixed(2)})`,
        );
      }

      const feetAfter = acceptedFeet(saved.verdicts);
      const acc = saved.verdicts.filter((v) => v.verdict === "wall").length;
      lines.push(
        `  ${dir.slice(0, 34).padEnd(34)} ${sheet.padEnd(6)} ${swaps.length} swap(s), ${appliedHere} applied\n` +
          `      accepted ${feetBefore.toFixed(1)} ft -> ${feetAfter.toFixed(1)} ft  (${acc} runs)` +
          (notes.length === 0 ? "" : `\n${notes.join("\n")}`),
      );

      if (appliedHere > 0) {
        sheetsTouched += 1;
        swapsApplied += appliedHere;
        if (WRITE) {
          // A copy beside the file, once — never overwritten by a second run,
          // so the ORIGINAL survives however many times this is re-run.
          const backup = `${path}.bak`;
          if (!existsSync(backup)) copyFileSync(path, backup);
          saved.counts = {
            ...(saved.counts ?? {}),
            accepted: saved.verdicts.filter((v) => v.verdict === "wall").length,
            rejected: saved.verdicts.filter((v) => v.verdict === "not-wall").length,
          };
          writeFileSync(path, `${JSON.stringify(saved, null, 1)}\n`, "utf8");
        }
      }
    }

     
    console.log(
      `\n${WRITE ? "WROTE" : "DRY RUN — nothing written"}: ` +
        `${swapsApplied} pre-marks across ${sheetsTouched} sheets\n${lines.join("\n")}`,
    );
    expect(lines.length, "no sheet was examined").toBeGreaterThan(0);
  });
});
