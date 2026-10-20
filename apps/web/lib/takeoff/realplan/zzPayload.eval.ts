import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── HOW BIG IS THE SAVE A REVIEWER SENDS? ──
 *
 * Bunkie A100 (page 31) failed to save with "The request body was not JSON",
 * while Baker A101 and MHK A1.01 had saved minutes earlier on the same build.
 * The server log named the cause without ambiguity:
 *
 *   Request body exceeded 10MB for /api/takeoff/labels. Only the first 10MB
 *   will be available unless configured.
 *
 * Truncated at 10 MB, so `request.json()` throws and the route reports the
 * only thing it can see — that the body was not JSON. The message is honest
 * and useless: nothing about it says SIZE.
 *
 * The sheet has 58 candidates. What makes the body large is not the
 * candidates but the PAIRINGS: every pairing the finder considered travels
 * with its feature vector, because `labelRows` needs them to turn verdicts
 * about runs into rows about pairings. On a hatch-heavy sheet that is a very
 * different number from the one on screen.
 *
 *     DATABASE_URL=…local… REAL_PLAN_DIR=… PAYLOAD_JOB=local-BUNKIEBIDDRAWINGS \
 *     PAYLOAD_PAGE=31 npx vitest run --config vitest.eval.config.mts \
 *       lib/takeoff/realplan/zzPayload.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const JOB = process.env.PAYLOAD_JOB ?? "";
const PAGE = Number(process.env.PAYLOAD_PAGE ?? "0");
/** The sheet's real scale. With 1 the finder reports nothing and the
 *  measurement is about a sheet nobody is looking at. */
const FPU = Number(process.env.PAYLOAD_FPU ?? "1");

describe.skipIf(DIR === "" || JOB === "" || PAGE === 0)("the save payload", () => {
  it("measures what a reviewer's save would send", { timeout: 3_600_000 }, async () => {
    const plan = await prisma.takeoffPlan.findFirst({
      where: { jobId: JOB },
      select: { fileUrl: true, fileName: true },
    });
    expect(plan, `no plan for job ${JOB}`).not.toBeNull();
    if (plan === null) return;

    const bytes = Buffer.from(readFileSync(join(DIR, plan.fileUrl.replace(/^local:/, ""))));
    const read = await sheetStrokes(bytes, PAGE);
    expect(read, "unreadable sheet").not.toBeNull();
    if (read === null) return;
    // The INPUT resolved to real geometry. Without this a page number that
    // matches nothing reads as a clean run that measured an empty sheet.
    expect(read.segments.length, `page ${PAGE} of ${plan.fileName} has no strokes`).toBeGreaterThan(0);
    const doc = await openPlanPdf(bytes);
    const text = await doc.pageText(PAGE);

    const pairings: { features: number[]; lengthFeet: number }[] = [];
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
      feetPerUnit: FPU,
      wallTypes: [],
      sampledSheets: null,
      onCandidate: (features: number[], wall: { lengthFeet: number }) =>
        pairings.push({ features, lengthFeet: wall.lengthFeet }),
    });

    // The body the panel builds, as closely as this can reproduce it.
    const body = JSON.stringify({
      set: plan.fileName,
      sheet: "A100",
      page: PAGE,
      reviewedBy: "AI-Claude-Chrome",
      feetPerUnit: FPU,
      secondsSpent: 100,
      reviewComplete: true,
      unreviewed: 0,
      candidates: pairings.map((p) => ({
        x1: 0.1,
        y1: 0.1,
        x2: 0.2,
        y2: 0.2,
        lengthFeet: p.lengthFeet,
        thicknessFeet: 0.5,
        features: p.features,
      })),
      verdicts: found.walls.map((w) => ({
        x1: w.x1,
        y1: w.y1,
        x2: w.x2,
        y2: w.y2,
        lengthFeet: w.lengthFeet,
        thicknessFeet: w.thicknessFeet,
        verdict: "wall",
      })),
    });

    const megabytes = Buffer.byteLength(body) / (1024 * 1024);
    const nonFinite = pairings.filter((p) => p.features.some((f) => !Number.isFinite(f))).length;

    // eslint-disable-next-line no-console
    console.log(
      `\n${JOB} page ${PAGE} (${plan.fileName})\n` +
        `  runs shown to the reviewer : ${found.walls.length}\n` +
        `  PAIRINGS sent with the save: ${pairings.length}\n` +
        `  features per pairing       : ${pairings[0]?.features.length ?? 0}\n` +
        `  body                       : ${megabytes.toFixed(2)} MB` +
        (megabytes > 10 ? "   ← OVER THE 10 MB LIMIT, truncated, unparseable" : "") +
        `\n  pairings with a non-finite feature: ${nonFinite}` +
        (nonFinite === 0 ? "  (so that is NOT the cause)" : "  ← suspect"),
    );

    expect(pairings.length, "the finder offered no pairings — nothing was measured").toBeGreaterThan(
      0,
    );
  });
});
