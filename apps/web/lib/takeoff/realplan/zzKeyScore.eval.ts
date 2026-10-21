import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, totalScore, type SheetScore } from "../heldOutScore";

/**
 * ── SCORING THE FINDER ON THE HELD-OUT BUILDINGS ──
 *
 * Central Bank, Gen BBQ, SLN Terminal and STEM Garrett. Their labels are the
 * TEST key and nothing trained on them, so this is the only number in the
 * programme that says what the finder does on a building it has never seen.
 *
 * The key is ACCEPTED plus TRACED walls. The traced half is what makes it a
 * test rather than a mirror: without it the key contains only walls the
 * finder already proposed, and a finder that proposes nothing scores
 * perfectly.
 *
 * ── A RUN WITH NO HELD-OUT LABELS REPORTS THAT, AND IS NOT A PASS ──
 *
 * The four buildings are labelled after the training sheets, so for a while
 * this finds nothing. It says so in as many words rather than printing a
 * clean total over zero sheets, which is the vacuous green this directory
 * exists to end.
 *
 *     DATABASE_URL=…local… REAL_PLAN_DIR=… TAKEOFF_LABEL_DIR=… \
 *       npx vitest run --config vitest.eval.config.mts \
 *         lib/takeoff/realplan/zzHeldOut.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";

type Saved = {
  set: string;
  sheet: string;
  page: number;
  feetPerUnit: number;
  verdicts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    lengthFeet: number;
    thicknessFeet: number;
    verdict: string;
  }[];
};

describe.skipIf(DIR === "" || LABELS === "")("the held-out buildings", () => {
  it("scores the rules against the answer key", { timeout: 7_200_000 }, async () => {
    const plans = await prisma.takeoffPlan.findMany({ select: { fileName: true, fileUrl: true } });
    const flat = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toUpperCase();

    // Every label file, then the held-out ones. Both counts are reported, so
    // "no held-out labels" is distinguishable from "no labels at all".
    const all: { dir: string; sheet: string; path: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      const full = join(LABELS, dir);
      if (!existsSync(full)) continue;
      let names: string[] = [];
      try {
        names = readdirSync(full).filter((n) => n.endsWith(".json"));
      } catch {
        continue;
      }
      for (const name of names) all.push({ dir, sheet: name.slice(0, -5), path: join(full, name) });
    }
    const held = all.filter((f) => heldOutReason(f.dir) !== null);

    const scores: SheetScore[] = [];
    const notes: string[] = [];

    for (const file of held) {
      const saved = JSON.parse(readFileSync(file.path, "utf8")) as Saved;
      const { key, fromTracedFeet } = keyFromLabels(saved);
      if (key.length === 0) {
        notes.push(`  ${file.dir}/${file.sheet}: labelled, but no accepted or traced walls`);
        continue;
      }
      const pdf =
        plans.find((p) => flat(p.fileName ?? "") === flat(file.dir))?.fileUrl?.replace(/^local:/, "") ??
        null;
      if (pdf === null) {
        notes.push(`  ${file.dir}/${file.sheet}: no ingested plan — SKIPPED, not scored`);
        continue;
      }
      const bytes = Buffer.from(readFileSync(join(DIR, pdf)));
      const read = await sheetStrokes(bytes, saved.page);
      if (read === null) {
        notes.push(`  ${file.dir}/${file.sheet}: unreadable — SKIPPED, not scored`);
        continue;
      }
      const doc = await openPlanPdf(bytes);
      const text = await doc.pageText(saved.page);
      const found = findWallsOnSheet({
        segments: read.segments,
        textItems: text.items.map((i) => ({
          str: i.str,
          x: i.x,
          y: i.y,
          width: i.width,
          height: i.height,
        })),
        pageSize: { widthPt: read.widthPt, heightPt: read.heightPt },
        feetPerUnit: saved.feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });
      scores.push(
        scoreSheet({
          set: file.dir,
          sheet: file.sheet,
          key,
          proposed: found.walls.map((w) => ({
            x1: w.x1,
            y1: w.y1,
            x2: w.x2,
            y2: w.y2,
            lengthFeet: w.lengthFeet,
            // ── THE THICKNESS IS THE WHOLE POINT OF THE BAND ──
            //
            // `WallCandidate`'s own comment says these coordinates are the
            // CENTRELINE. A reviewer tracing a wall the finder missed draws
            // along a FACE, half a thickness away, and a traced key wall
            // carries no thickness of its own — so if this is dropped, every
            // trace/proposal pair falls back to the 1.5 ft floor and the
            // thickness-aware band never fires on the only case it exists
            // for. Dropped here, the scorer was thickness-aware in name only.
            thicknessFeet: w.thicknessFeet,
          })),
          feetPerUnit: saved.feetPerUnit,
          keyFromTracedFeet: fromTracedFeet,
        }),
      );
    }

    const total = totalScore(scores);
    const lines = scores.map(
      (s) =>
        `  ${s.set.slice(0, 26).padEnd(26)} ${s.sheet.padEnd(7)}` +
        ` key ${s.keyFeet.toFixed(0).padStart(6)} ft` +
        ` (traced ${s.keyFromTraced.toFixed(0)})` +
        ` · proposed ${s.proposedFeet.toFixed(0).padStart(6)}` +
        ` · missing ${s.missingFeet.toFixed(0).padStart(5)}` +
        ` · extra ${s.extraFeet.toFixed(0).padStart(5)}` +
        ` · net ${s.netFeet >= 0 ? "+" : ""}${s.netFeet.toFixed(0)}`,
    );

    // eslint-disable-next-line no-console
    console.log(
      held.length === 0
        ? `\nNO HELD-OUT LABELS YET — ${all.length} label files exist and none is from a ` +
            `held-out building.\nThis is not a pass: nothing was scored. The harness is ` +
            `wired and will report as soon as\nCentral Bank, Gen BBQ, SLN Terminal or STEM ` +
            `Garrett is labelled.`
        : `\nheld-out sheets scored: ${scores.length} of ${held.length} labelled\n` +
            `${lines.join("\n")}\n` +
            `${notes.length === 0 ? "" : `${notes.join("\n")}\n`}` +
            `  TOTAL  key ${total.keyFeet.toFixed(0)} ft ` +
            `(${total.keyFromTraced.toFixed(0)} of it traced) · ` +
            `missing ${total.missingFeet.toFixed(0)} · extra ${total.extraFeet.toFixed(0)} · ` +
            `net ${total.netFeet >= 0 ? "+" : ""}${total.netFeet.toFixed(0)}`,
    );

    // The assertion is about the HARNESS, not the score: a label directory
    // that cannot be read is a broken run, and a held-out file that was found
    // but silently not scored must not pass as success.
    expect(all.length, "no label files at all — check TAKEOFF_LABEL_DIR").toBeGreaterThan(0);
    expect(scores.length, "held-out sheets were found but none could be scored").toBe(
      held.length - notes.length,
    );
  });
});
