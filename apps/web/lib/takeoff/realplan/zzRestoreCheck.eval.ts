import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { startReview, type Candidate } from "../answerKeyReview";
import { restoreSaved, type SavedSheet } from "../restoreSaved";

/**
 * ── WHAT A REOPEN ACTUALLY DOES, ON EVERY LABELLED SHEET ──
 *
 * The restore matches saved verdicts to the candidates the finder produces
 * NOW. Both halves of that can move: the finder changes, and the saved file
 * ages. So the only honest way to know what reopening does is to do it, per
 * sheet, and print the numbers.
 *
 * It exists because a split heuristic invented a cut on MHK A1.01 — a sheet
 * never split — and the symptoms (38 of 39 reviewed, accepted footage 524 ->
 * 509, the duplicate box from five pairs to one) all looked like the finder
 * had changed. None of them was: `splitCandidate` drops duplicate pairs
 * naming the candidate it replaces, so one bad split moved four numbers at
 * once.
 *
 * Two things this must show, and they are the acceptance test for that fix:
 *
 *   - MHK A1.01 re-applies ZERO splits;
 *   - Baker EOC A101 and NG Green Bay A3.1, which were really split, get
 *     their decisions back.
 *
 * ALL labelled sheets, including the held-out ones: this reads what a reopen
 * does and trains nothing, which is the one thing a held-out sheet may be
 * used for — the reviewer has to be able to reopen them too.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";

describe.skipIf(DIR === "" || LABELS === "")("reopening every labelled sheet", () => {
  it("reports decisions restored, unmatched and splits, per sheet", { timeout: 7_200_000 }, async () => {
    const plans = await prisma.takeoffPlan.findMany({ select: { fileName: true, fileUrl: true } });
    const flat = (t: string) => t.replace(/[^a-z0-9]+/gi, "").toUpperCase();

    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      const here = join(LABELS, dir);
      if (!existsSync(here)) continue;
      for (const name of readdirSync(here)) {
        if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
      }
    }

    const read: string[] = [];
    const rows: string[] = [];
    let worstUnmatched = 0;
    let splitsAnywhere = 0;

    for (const file of files.sort((a, b) => `${a.dir}${a.sheet}`.localeCompare(`${b.dir}${b.sheet}`))) {
      const saved = JSON.parse(
        readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8"),
      ) as SavedSheet & { counts?: Record<string, number>; feetPerUnit: number; page: number };
      const pdf =
        plans.find((p) => flat(p.fileName ?? "") === flat(file.dir))?.fileUrl?.replace(/^local:/, "") ??
        null;
      if (pdf === null) continue;

      const bytes = Buffer.from(readFileSync(join(DIR, pdf)));
      const strokes = await sheetStrokes(bytes, saved.page);
      const doc = await openPlanPdf(bytes);
      const text = await doc.pageText(saved.page);
      const found = findWallsOnSheet({
        segments: strokes.segments,
        textItems: text.items.map((i) => ({
          str: i.str,
          x: i.x,
          y: i.y,
          width: i.width,
          height: i.height,
        })),
        pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
        feetPerUnit: saved.feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });

      // The candidate list the panel would show, in the panel's own shape.
      const candidates: Candidate[] = found.walls.map((w, at) => ({
        id: `w${at}`,
        x1: w.x1,
        y1: w.y1,
        x2: w.x2,
        y2: w.y2,
        lengthFeet: w.lengthFeet,
        thicknessIn: w.thicknessFeet > 0 ? w.thicknessFeet * 12 : null,
        from: "pair",
        note: "",
      }));
      const fresh = startReview(candidates, saved.feetPerUnit);
      const got = restoreSaved(saved, fresh, saved.feetPerUnit);

      read.push(`${file.dir}/${file.sheet}`);
      const savedDecisions = (saved.verdicts ?? []).filter(
        (v) => v.verdict === "wall" || v.verdict === "not-wall" || v.verdict === "unsure",
      ).length;
      const savedTraces = (saved.verdicts ?? []).filter((v) => v.verdict === "traced").length;

      // ── WHY A SHEET REFUSES, NOT JUST THAT IT DOES ──
      //
      // Baker EOC A101 restored 38 decisions under the loose heuristic and
      // refuses at 31 of 40 under the strict one. Either those nine are split
      // halves the strict rule will not prove, or the finder's candidates have
      // moved. Those need different fixes, so the difference is printed
      // rather than argued about.
      if (process.env.RESTORE_WHY !== undefined && !got.ok) {
        const decidedSaved = (saved.verdicts ?? []).filter(
          (v) => v.verdict === "wall" || v.verdict === "not-wall" || v.verdict === "unsure",
        );
        console.log(`\n  WHY ${file.dir}/${file.sheet} refuses:`);
        for (const v of decidedSaved) {
          let nearest = Infinity;
          let nearestLen = 0;
          for (const c of candidates) {
            const d = Math.hypot((v.x1 + v.x2) / 2 - (c.x1 + c.x2) / 2, (v.y1 + v.y2) / 2 - (c.y1 + c.y2) / 2) * saved.feetPerUnit;
            if (d < nearest) {
              nearest = d;
              nearestLen = c.lengthFeet;
            }
          }
          if (nearest > 2) {
            console.log(
              `      ${v.verdict.padEnd(9)} ${v.lengthFeet.toFixed(1).padStart(6)} ft  ` +
                `thickness ${((v.thicknessFeet ?? 0) * 12).toFixed(1).padStart(5)} in  ` +
                `nearest candidate ${nearest.toFixed(1)} ft away, ${nearestLen.toFixed(1)} ft long`,
            );
          }
        }
      }

      if (!got.ok) {
        rows.push(
          `  ${`${file.dir.slice(0, 26)}/${file.sheet}`.padEnd(34)} REFUSED — ${got.message.slice(0, 80)}`,
        );
        worstUnmatched = Math.max(worstUnmatched, savedDecisions);
        continue;
      }
      splitsAnywhere += got.splitsReapplied;
      worstUnmatched = Math.max(worstUnmatched, got.unmatched);
      rows.push(
        `  ${`${file.dir.slice(0, 26)}/${file.sheet}`.padEnd(34)} ` +
          `${String(got.decisions).padStart(4)}/${String(savedDecisions).padEnd(4)} decisions · ` +
          `${String(got.unmatched).padStart(3)} unmatched · ` +
          `${String(got.traces).padStart(3)}/${String(savedTraces).padEnd(3)} traces · ` +
          `${got.splitsReapplied} split${got.splitsReapplied === 1 ? "" : "s"} re-applied`,
      );
    }

    expect(read.length, "no labelled sheets were read, so every number would be zero").toBeGreaterThan(0);

    console.log(`\n${read.length} labelled sheets reopened against the CURRENT finder\n`);
    for (const row of rows) console.log(row);
    console.log(
      `\nworst unmatched on any sheet: ${worstUnmatched} · splits re-applied in total: ${splitsAnywhere}`,
    );
    console.log(
      "MHK A1.01 must show 0 splits — it was never split, and inferring one there is the regression this guards",
    );
  });
});
