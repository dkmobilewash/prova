import { prisma } from "@prova/db";
import type { SheetRow } from "./sheetIndex";

/**
 * The sheet index for one plan set, as the review screen needs it.
 *
 * TWO QUERIES AND A JOIN IN MEMORY, rather than one clever one. The rows are
 * bounded at 2,000 pages by `startPlanIngest`, so this is a small in-process merge
 * — and it keeps the "newest proposal per page" rule in TypeScript where it can be
 * read, instead of in a window function nobody will revisit.
 *
 * THE NEWEST PROPOSAL PER PAGE WINS, which is the whole reason `PlanSheetProposal`
 * is keyed on the run rather than the page: a second `TITLE_BLOCK` pass inserts its
 * own rows and does not overwrite what somebody already accepted from the first.
 * Derived from `createdAt` at read time, never stored — the same rule
 * `TakeoffScaleCalibration` follows for the active calibration.
 *
 * SCOPED BY THE PLAN'S COMPANY, from the session and not from the argument. Both
 * queries carry it, because a `planId` in a URL is a claim.
 */
export async function sheetIndexFor(planId: string, companyId: string): Promise<SheetRow[]> {
  const [texts, proposals] = await Promise.all([
    prisma.planSheetText.findMany({
      where: { planId, plan: { companyId } },
      select: { pageNumber: true, hasTextLayer: true },
      orderBy: { pageNumber: "asc" },
    }),
    prisma.planSheetProposal.findMany({
      where: { planId, plan: { companyId } },
      select: {
        id: true,
        pageNumber: true,
        proposedSheetNumber: true,
        proposedTitle: true,
        proposedDiscipline: true,
        proposedPageType: true,
        proposedScale: true,
        titleBlockRevisionText: true,
        titleBlockIssueDateText: true,
        proposedReason: true,
        proposedConfidence: true,
        status: true,
        acceptedSheetNumber: true,
        acceptedTitle: true,
        createdAt: true,
      },
      // Newest last, so the loop below simply overwrites and the final value per
      // page is the newest run's.
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const newest = new Map<number, (typeof proposals)[number]>();
  for (const proposal of proposals) newest.set(proposal.pageNumber, proposal);

  return texts.map((text) => {
    const proposal = newest.get(text.pageNumber);
    return {
      pageNumber: text.pageNumber,
      hasTextLayer: text.hasTextLayer,
      proposal: proposal
        ? {
            id: proposal.id,
            sheetNumber: proposal.proposedSheetNumber,
            title: proposal.proposedTitle,
            discipline: proposal.proposedDiscipline,
            pageType: proposal.proposedPageType,
            scale: proposal.proposedScale,
            revision: proposal.titleBlockRevisionText,
            issueDate: proposal.titleBlockIssueDateText,
            reason: proposal.proposedReason,
            confidence: proposal.proposedConfidence,
            status: proposal.status,
            acceptedSheetNumber: proposal.acceptedSheetNumber,
            acceptedTitle: proposal.acceptedTitle,
          }
        : null,
    };
  });
}
