import { Prisma, prisma } from "@prova/db";
import { extractWallLegend, WALL_LEGEND_PROMPT_VERSION, type WallLegendRead } from "@prova/integrations/src/wallLegend";
import { aiGate } from "@/lib/ai/settings";
import { claimPlanSheet, markPlanSheetFailure } from "@/lib/ask/planSheetSpend";
import { recordAskUsage } from "@/lib/ask/usage";
import { legendPages } from "@/lib/takeoff/legendPages";
import { legendProposalFrom } from "@/lib/takeoff/legendProposalBuild";
import { legendCropRects, type CropRect } from "@/lib/takeoff/legendSight";
import { pageLines } from "@/lib/takeoff/planTextRead";
import { tagSymbols } from "@/lib/takeoff/tagSymbols";
import { openPlanPdf } from "./planPdf";
import { readPlanBytes } from "./planBytes";
import type { StageCtx, StageWork } from "./stages";

/**
 * ── THE WALL LEGEND, READ ONCE PER SET FOR REVIEW ──
 *
 * One task per page, like every stage; a model call only on a page whose own
 * words say it legends the walls (`legendPages` rank 0–2: a titled legend, a
 * headed block, or a dozen assembly lines — never a sheet that merely names a
 * legend in its index, and an engineer's sheet is tried as a last resort by
 * the same ranking). The read is the WORDS; the drawing is read later, from
 * the review screen, because the server has no rasteriser. The crop rectangle
 * for each type is worked out here from the page's text and symbols
 * (`legendCropRects`) and stored, so the screen cuts the crop the reader
 * placed rather than guessing again.
 *
 * Behind the PLAN_TEXT_READ opt-in and metered as a plan sheet, exactly as
 * the schedule stage is. Nothing here is a price.
 */

/** The ranks that are a legend. 3 is "a title and nothing under it"; 10+ is a demoted trade sheet. */
const LEGEND_RANK_CEILING = 2;

export type WallLegendDeps = {
  loadPageTitle: (planId: string, pageNumber: number) => Promise<string | null>;
  loadBytes: (planId: string, companyId: string) => Promise<Buffer>;
  gate: (companyId: string) => ReturnType<typeof aiGate>;
  claim: typeof claimPlanSheet;
  markFailure: typeof markPlanSheetFailure;
  extract: typeof extractWallLegend;
  saveProposal: (row: WallLegendProposalRow) => Promise<void>;
  recordUsage: typeof recordAskUsage;
};

export type WallLegendProposalRow = {
  ingestJobId: string;
  planId: string;
  pageNumber: number;
  sheetTitle: string | null;
  model: string;
  read: WallLegendRead;
  crops: CropRect[];
};

export function wallLegendWork(ctx: StageCtx, deps: WallLegendDeps = realDeps): StageWork {
  return async (task) => {
    const title = await deps.loadPageTitle(ctx.planId, task.pageNumber);
    const bytes = await deps.loadBytes(ctx.planId, ctx.companyId);
    const pdf = await openPlanPdf(bytes);
    let lines: string[];
    let crops: (codes: string[]) => CropRect[];
    try {
      lines = await pageLines(pdf, task.pageNumber);
      const candidate = legendPages([{ page: task.pageNumber, title, lines }])[0];
      if (candidate === undefined || candidate.rank > LEGEND_RANK_CEILING) return { ok: true };
      const text = await pdf.pageText(task.pageNumber);
      const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const strokes = await pdf.pageStrokes(task.pageNumber);
      const symbols = tagSymbols({ segments: strokes.segments, text: items, unitsPerPaperInch: 72 });
      crops = (codes) => legendCropRects({ text: items, codes, widthPt: text.widthPt, heightPt: text.heightPt, symbols });
    } finally {
      await pdf.close();
    }

    const pass = await deps.gate(ctx.companyId);
    if (!pass.ok) return { ok: false, error: pass.error };
    const claimed = await deps.claim(ctx.companyId, pass.settings.planSheetsPerMonth);
    if (!claimed.ok) return { ok: false, error: claimed.error };

    let read: WallLegendRead;
    try {
      read = await deps.extract({
        lines,
        pageNumber: task.pageNumber,
        sheetTitle: title,
        model: pass.model,
        onUsage: (usage) =>
          deps.recordUsage({
            companyId: ctx.companyId,
            userId: ctx.startedByUserId,
            feature: "plan-text-read",
            model: pass.model,
            outcome: "proposal",
            jobId: ctx.jobId,
            promptVersion: WALL_LEGEND_PROMPT_VERSION,
            usage,
          }),
      });
    } catch {
      await deps.markFailure(claimed.claim);
      return { ok: false, error: "The wall legend on this sheet could not be read. Try it again." };
    }
    // A page that looked like a legend and held no types is not a failure and
    // not a proposal — nothing to review.
    if (read.types.length === 0) return { ok: true };

    await deps.saveProposal({
      ingestJobId: ctx.ingestJobId,
      planId: ctx.planId,
      pageNumber: task.pageNumber,
      sheetTitle: title,
      model: pass.model,
      read,
      crops: crops(read.types.map((t) => t.code)),
    });
    return { ok: true };
  };
}

const realDeps: WallLegendDeps = {
  loadPageTitle: async (planId, pageNumber) => {
    const proposal = await prisma.planSheetProposal.findFirst({
      where: { planId, pageNumber },
      orderBy: { createdAt: "desc" },
      select: { acceptedTitle: true, proposedTitle: true },
    });
    return proposal === null ? null : (proposal.acceptedTitle ?? proposal.proposedTitle);
  },
  loadBytes: async (planId, companyId) => {
    const bytes = await readPlanBytes(planId, companyId);
    if (!bytes.ok) throw new Error(bytes.error);
    return bytes.bytes;
  },
  gate: (companyId) => aiGate(companyId, "PLAN_TEXT_READ"),
  claim: claimPlanSheet,
  markFailure: markPlanSheetFailure,
  extract: extractWallLegend,
  recordUsage: recordAskUsage,
  saveProposal: async (row) => {
    const proposal = legendProposalFrom(row);
    await prisma.planLegendProposal.upsert({
      where: { ingestJobId_pageNumber: { ingestJobId: row.ingestJobId, pageNumber: row.pageNumber } },
      create: { ingestJobId: row.ingestJobId, planId: row.planId, pageNumber: row.pageNumber, ...proposal },
      // A re-read replaces the words AND forgets the drawing's read of the old words.
      update: { ...proposal, sightRead: Prisma.DbNull },
    });
  },
};
