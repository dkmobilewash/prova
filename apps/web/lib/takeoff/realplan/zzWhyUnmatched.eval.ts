import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetStrokes } from "../sheetStrokes";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { pagesToSample } from "../sheetTemplate";
import { inPageWidthUnits } from "../findWallsOnSheet";
import { restoreSaved } from "../restoreSaved";
import type { StrokeSegment } from "../wallVectors";

/**
 * ── WHICH SAVED DECISIONS DO NOT MATCH, AND WHY ──
 *
 * The smoke's split scenario reports "2 saved decisions kept but not shown"
 * and I guessed at the cause three times — a duplicate split record, a
 * missing one, a half being halved — and was wrong three times. Each guess
 * was plausible and none was measured, which is the habit this directory
 * exists to break.
 *
 * So this replays a label file through `restoreSaved` against the candidate
 * list the app would actually show, in Node, and prints every decision that
 * found nothing with the nearest candidate to it. A second of feedback
 * instead of four minutes, and an answer instead of a theory.
 *
 * Point it at a file with `WHY_SET` and `WHY_SHEET`.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const SET = process.env.WHY_SET ?? "";
const SHEET = process.env.WHY_SHEET ?? "";

const len = (a: { x1: number; y1: number; x2: number; y2: number }) =>
  Math.hypot(a.x2 - a.x1, a.y2 - a.y1);

describe.skipIf(DIR === "" || LABELS === "" || SET === "")("why a decision found nothing", () => {
  it("names each unmatched decision and its nearest candidate", { timeout: 1_800_000 }, async () => {
    const saved = JSON.parse(readFileSync(join(LABELS, SET, `${SHEET}.json`), "utf8")) as {
      page: number;
      feetPerUnit: number;
      verdicts: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        lengthFeet: number;
        thicknessIn?: number | null;
        verdict: string;
      }[];
      splits?: unknown[];
      traced?: unknown[];
    };

    const plans = await prisma.takeoffPlan.findMany({ select: { fileName: true, fileUrl: true } });
    const flat = (t: string) => t.replace(/[^a-z0-9]+/gi, "").toUpperCase();
    const pdf =
      plans.find((p) => flat(p.fileName ?? "") === flat(SET))?.fileUrl?.replace(/^local:/, "") ??
      null;
    expect(pdf, `no ingested plan matches ${SET}`).not.toBeNull();

    const bytes = Buffer.from(readFileSync(join(DIR, pdf!)));
    const strokes = await sheetStrokes(bytes, saved.page);
    expect(strokes, "the page did not read").not.toBeNull();
    const doc = await openPlanPdf(bytes);
    const text = await doc.pageText(saved.page);
    const textItems = text.items.map((i) => ({
      str: i.str,
      x: i.x,
      y: i.y,
      width: i.width,
      height: i.height,
    }));
    const sampled: StrokeSegment[][] = [];
    for (const n of pagesToSample(doc.pageCount, saved.page)) {
      const read =
        n === saved.page ? strokes! : await sheetStrokes(Buffer.from(readFileSync(join(DIR, pdf!))), n);
      if (read === null) continue;
      sampled.push(read.segments.map(inPageWidthUnits(read.widthPt || strokes!.widthPt)));
    }
    const detected = detectForSheet({
      segments: strokes!.segments,
      textItems,
      pageSize: { widthPt: strokes!.widthPt, heightPt: strokes!.heightPt },
      feetPerUnit: saved.feetPerUnit,
      sampledSheets: sampled,
    });
    const offered = offeredCandidates({
      walls: detected.found.walls,
      segments: detected.found.inUnits.map((one: StrokeSegment) => ({
        ...one,
        x1: one.x1 * strokes!.widthPt,
        y1: one.y1 * strokes!.widthPt,
        x2: one.x2 * strokes!.widthPt,
        y2: one.y2 * strokes!.widthPt,
      })),
      widthPt: strokes!.widthPt,
      feetPerUnit: saved.feetPerUnit,
      planBoxes: detected.planBoxes,
    });

    const result = restoreSaved(
      saved as never,
      {
        candidates: offered.candidates,
        verdicts: Object.fromEntries(offered.candidates.map((c) => [c.id, "unreviewed"])),
        duplicates: [],
        traced: [],
        splits: [],
      } as never,
      saved.feetPerUnit,
    ) as {
      unmatched?: unknown[];
      splitsReapplied?: number;
      decisions?: number;
      message?: string;
    };

    console.log(`\n${SET}/${SHEET} · page ${saved.page} · fpu ${saved.feetPerUnit.toFixed(3)}`);
    console.log(`  saved verdicts   ${saved.verdicts.length}`);
    console.log(`  split records    ${(saved.splits ?? []).length}`);
    console.log(`  candidates now   ${offered.candidates.length}`);
    console.log(`  splits re-applied ${result.splitsReapplied ?? "?"}`);
    console.log(`  restore says     ${result.message ?? "(nothing)"}`);

    const unmatched = (result.unmatched ?? []) as {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      lengthFeet: number;
      verdict?: string;
    }[];
    console.log(`\n  UNMATCHED ${unmatched.length}`);
    for (const one of unmatched) {
      // The nearest candidate by midpoint, with the two numbers the target
      // test actually uses, so the refusal is readable rather than guessed.
      const mx = (one.x1 + one.x2) / 2;
      const my = (one.y1 + one.y2) / 2;
      let best: { id: string; dFt: number; lenFt: number } | null = null;
      for (const c of offered.candidates) {
        const cx = (c.x1 + c.x2) / 2;
        const cy = (c.y1 + c.y2) / 2;
        const d = Math.hypot(mx - cx, my - cy) * saved.feetPerUnit;
        if (best === null || d < best.dFt) best = { id: c.id, dFt: d, lenFt: c.lengthFeet };
      }
      console.log(
        `    ${one.verdict ?? "?"} len ${one.lengthFeet.toFixed(1)}ft · ` +
          `nearest candidate ${best === null ? "none" : `${best.dFt.toFixed(1)}ft away, ${best.lenFt.toFixed(1)}ft long`} · ` +
          `on-sheet length ${(len(one) * saved.feetPerUnit).toFixed(1)}ft`,
      );
    }

    expect(saved.verdicts.length, "the file read as empty, so nothing below means anything").toBeGreaterThan(0);
  });
});
