import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { duplicatePairs } from "../duplicateCandidates";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import type { Candidate } from "../answerKeyReview";

/**
 * ── DOES THE DUPLICATE RULE KEEP THE TWIN THE REVIEWER ACCEPTED? ──
 *
 * Every earlier measurement of this rule counted how many pre-marks CHANGED.
 * That is a measure of disturbance, not of correctness: four swaps is equally
 * consistent with four fixes and four new mistakes. Nine labelled sheets now
 * exist, so the question can be asked the right way round — of each pair the
 * rule decides, did a human accept the one it kept?
 *
 * Scored only on pairs where the reviewer actually SPLIT the twins, accepting
 * one and rejecting the other. A pair the reviewer rejected entirely says
 * nothing about which reading was better, and counting those as agreement
 * would let a rule that keeps the wrong twin every time score well on sheets
 * full of furniture.
 *
 *     DATABASE_URL=…local… REAL_PLAN_DIR=… TAKEOFF_LABEL_DIR=… \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzDupAgree.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";

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
  verdicts: SavedVerdict[];
};

/** About three inches at these scales — see `zzDupResave`'s note. */
const SAME = 0.001;

function sameRun(a: { x1: number; y1: number; x2: number; y2: number }, b: SavedVerdict): boolean {
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

describe.skipIf(DIR === "" || LABELS === "")("the duplicate rule against the reviewers", () => {
  it("keeps the twin a human accepted", { timeout: 7_200_000 }, async () => {
    const plans = await prisma.takeoffPlan.findMany({ select: { fileName: true, fileUrl: true } });
    const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();

    const files: { dir: string; sheet: string; path: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      const full = join(LABELS, dir);
      if (!existsSync(full)) continue;
      let names: string[] = [];
      try {
        names = readdirSync(full).filter((n) => n.endsWith(".json"));
      } catch {
        continue;
      }
      for (const name of names) {
        files.push({ dir, sheet: name.slice(0, -5), path: join(full, name) });
      }
    }
    // A run over no label files would report a perfect score about nothing.
    expect(files.length, "no label files found").toBeGreaterThan(0);

    let decided = 0;
    let agreed = 0;
    let bySupport = 0;
    let byLength = 0;
    const wrong: string[] = [];
    const lines: string[] = [];

    for (const file of files) {
      const saved = JSON.parse(readFileSync(file.path, "utf8")) as Saved;
      const pdf =
        plans.find((p) => flat(p.fileName ?? "") === flat(file.dir))?.fileUrl?.replace(/^local:/, "") ??
        null;
      if (pdf === null) {
        lines.push(`  ${file.dir}/${file.sheet}: no ingested plan — skipped`);
        continue;
      }
      const bytes = Buffer.from(readFileSync(join(DIR, pdf)));
      const read = await sheetStrokes(bytes, saved.page);
      if (read === null) continue;
      const doc = await openPlanPdf(bytes);
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
      const pairs = duplicatePairs(candidates, saved.feetPerUnit, inUnits);

      let here = 0;
      let hereOk = 0;
      for (const pair of pairs) {
        const keep = candidates.find((c) => c.id === pair.keep);
        const drop = candidates.find((c) => c.id === pair.drop);
        if (keep === undefined || drop === undefined) continue;
        const keepRow = saved.verdicts.find((v) => sameRun(keep, v));
        const dropRow = saved.verdicts.find((v) => sameRun(drop, v));
        if (keepRow === undefined || dropRow === undefined) continue;
        // Only a pair the reviewer SPLIT says which reading was better.
        const split =
          (keepRow.verdict === "wall") !== (dropRow.verdict === "wall") &&
          (keepRow.verdict === "wall" || keepRow.verdict === "not-wall") &&
          (dropRow.verdict === "wall" || dropRow.verdict === "not-wall");
        if (!split) continue;
        decided += 1;
        here += 1;
        const ok = keepRow.verdict === "wall";
        if (ok) {
          agreed += 1;
          hereOk += 1;
        } else {
          wrong.push(
            `  ${file.dir.slice(0, 28)}/${file.sheet}: kept ${keep.lengthFeet.toFixed(1)}ft/` +
              `${(keep.thicknessIn ?? 0).toFixed(1)}in (support ${pair.support?.keep.toFixed(2) ?? "-"}` +
              `), reviewer took ` +
              `${drop.lengthFeet.toFixed(1)}ft/${(drop.thicknessIn ?? 0).toFixed(1)}in` +
              ` (support ${pair.support?.drop.toFixed(2) ?? "-"})`,
          );
        }
        // ── WHICH SIGNAL SETTLED IT, AND WHY THIS IS NOT READ OFF A FIELD ──
        //
        // The condition here has to be the SAME one the rule applies. An
        // earlier version of this counter had a third branch for a thickness
        // signal that no longer exists, and it went on attributing seventy-odd
        // pairs to it — a tally of a rule that was not running, which is this
        // directory's commonest way of being confidently wrong.
        if (pair.support != null && Math.abs(pair.support.keep - pair.support.drop) >= 0.2) {
          bySupport += 1;
        } else {
          byLength += 1;
        }
      }
      if (here > 0) {
        lines.push(
          `  ${file.dir.slice(0, 30).padEnd(30)} ${file.sheet.padEnd(7)} ${hereOk}/${here}`,
        );
      }
    }

     
    console.log(
      `\nthe reviewer split ${decided} duplicate pairs across ${files.length} label files\n` +
        `agreed on ${agreed} of ${decided}` +
        (decided === 0 ? "" : ` (${Math.round((agreed / decided) * 100)}%)`) +
        `\nsettled by: support ${bySupport}, length ${byLength}\n` +
        `${lines.join("\n")}` +
        (wrong.length === 0 ? "\n\nnone wrong" : `\n\nkept the twin the reviewer rejected:\n${wrong.join("\n")}`),
    );
    expect(files.length).toBeGreaterThan(0);
  });
});
