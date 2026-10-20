import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { drawingRegions, segmentsInRegions } from "../planRegion";
import { sheetViews, viewRegions } from "../sheetViews";

/**
 * ── WHY DOES A SHEET OFFER NOTHING TO REVIEW? ──
 *
 * "Nothing to review on this sheet" is one message for several very different
 * failures, and guessing between them is how a guard gets relaxed for a sheet
 * that never needed it. This walks the finder's own stages and reports what
 * survived each one, so the stage that empties the list names itself:
 *
 *     strokes read → drawing regions → views → segments kept → pairings → runs
 *
 * Murray A101 (page 24) returned zero on 2026-10-20. It shares the sheet with
 * a ceiling plan, which made view-caption rejection the first suspect.
 *
 *     DATABASE_URL=…local… REAL_PLAN_DIR=… WHYNONE_JOB=local-IFBREBIDMurrayTowe \
 *     WHYNONE_PAGE=24 WHYNONE_FPU=… npx vitest run --config vitest.eval.config.mts \
 *       lib/takeoff/realplan/zzWhyNone.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const JOB = process.env.WHYNONE_JOB ?? "";
const PAGE = Number(process.env.WHYNONE_PAGE ?? "0");
const FPU = Number(process.env.WHYNONE_FPU ?? "0");

describe.skipIf(DIR === "" || JOB === "" || PAGE === 0)("why a sheet offers nothing", () => {
  it("names the stage that empties the list", { timeout: 3_600_000 }, async () => {
    const plan = await prisma.takeoffPlan.findFirst({
      where: { jobId: JOB },
      select: { fileUrl: true, fileName: true },
    });
    expect(plan, `no plan for job ${JOB}`).not.toBeNull();
    if (plan === null) return;

    const bytes = Buffer.from(readFileSync(join(DIR, plan.fileUrl.replace(/^local:/, ""))));
    const read = await sheetStrokes(bytes, PAGE);
    expect(read, "the page could not be read at all").not.toBeNull();
    if (read === null) return;
    expect(read.segments.length, "the page has no strokes — nothing downstream matters").toBeGreaterThan(0);

    const doc = await openPlanPdf(bytes);
    const text = await doc.pageText(PAGE);
    const items = text.items.map((i) => ({
      str: i.str,
      x: i.x,
      y: i.y,
      width: i.width,
      height: i.height,
    }));
    const pageSize = { widthPt: read.widthPt, heightPt: read.heightPt };

    // ── STAGE BY STAGE ──
    //
    // `drawingRegions` REFINES regions it is given, so the starting point is
    // the whole page: asking it to refine nothing would report nothing and
    // look like a finding.
    const wholePage = [{ from: 0, to: 1, fromY: 0, toY: read.heightPt / read.widthPt }];
    const regions = drawingRegions(wholePage, read.segments, read.widthPt);
    const inRegions = segmentsInRegions(read.segments, regions, read.widthPt);
    const views = sheetViews(items, read.widthPt);
    const vRegions = viewRegions(read.segments, pageSize);

    const pairings: number[] = [];
    const found = findWallsOnSheet({
      segments: read.segments,
      textItems: items,
      pageSize,
      feetPerUnit: FPU,
      wallTypes: [],
      sampledSheets: null,
      onCandidate: () => pairings.push(1),
    });

    const captions = views
      .map(
        (v, at) =>
          `      view ${at + 1}: "${v.name.slice(0, 44)}" · scale ` +
          `${v.scaleName ?? "(none)"} · ${v.feetPerInch === null ? "NOT MEASURABLE" : `${v.feetPerInch} ft/in`}`,
      )
      .join("\n");

    // eslint-disable-next-line no-console
    console.log(
      `\n${JOB} page ${PAGE} — ${plan.fileName}\n` +
        `  scale used            : ${FPU.toFixed(1)} ft across the page\n` +
        `  strokes on the page   : ${read.segments.length}\n` +
        `  drawing regions       : ${regions.length}\n` +
        `  strokes inside them   : ${inRegions.length}\n` +
        `  views found           : ${views.length}\n` +
        (captions === "" ? "" : `${captions}\n`) +
        `  view regions          : ${vRegions.length}\n` +
        `  PAIRINGS offered      : ${pairings.length}\n` +
        `  runs shown            : ${found.walls.length}` +
        (found.walls.length === 0 ? "   ← NOTHING TO REVIEW" : ""),
    );

    expect(regions.length + views.length, "neither regions nor views were computed").toBeGreaterThan(
      0,
    );
  });
});
