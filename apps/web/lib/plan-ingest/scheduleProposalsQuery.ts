import { prisma } from "@prova/db";
import { isScheduleRowArray } from "./scheduleRowsJson";
import type { ScheduleProposalView } from "@/components/ScheduleProposals";

/**
 * The schedule readings a plan set has, and how many sheets reading them costs.
 *
 * TWO FUNCTIONS RATHER THAN ONE, because the panel needs the COUNT before any
 * reading exists and the review surface needs the ROWS after. Folding them
 * together would make the button's cost figure depend on a query that returns
 * nothing until the button has been pressed.
 */

/**
 * How many sheets the title blocks called SCHEDULE — what the read will cost.
 *
 * COUNTED OVER THE NEWEST PROPOSAL PER PAGE, not over every proposal row. A set
 * re-ingested twice has three proposals per page, and counting rows would tell
 * somebody a four-sheet set costs twelve.
 */
export async function scheduleSheetCountFor(planId: string): Promise<number> {
  const proposals = await prisma.planSheetProposal.findMany({
    where: { planId },
    orderBy: { createdAt: "desc" },
    select: { pageNumber: true, proposedPageType: true },
  });
  const newestByPage = new Map<number, string | null>();
  for (const proposal of proposals) {
    if (!newestByPage.has(proposal.pageNumber)) newestByPage.set(proposal.pageNumber, proposal.proposedPageType);
  }
  return [...newestByPage.values()].filter((pageType) => pageType === "SCHEDULE").length;
}

/**
 * The readings themselves, newest per page, with the sheet number a person
 * accepted where there is one.
 *
 * `rows` IS VALIDATED ON THE WAY OUT, not trusted. It is a `Json` column, so a
 * row written by an older build — or by a reader whose shape has since changed —
 * is not evidence of anything. The same posture `findingsFromJson` takes for
 * spec findings, and the reason `verticesProblem` runs on the way out as well as
 * the way in.
 */
export async function loadScheduleProposals(planId: string): Promise<ScheduleProposalView[]> {
  const proposals = await prisma.planScheduleProposal.findMany({
    where: { planId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      pageNumber: true,
      kind: true,
      title: true,
      rows: true,
      reason: true,
      confidence: true,
      gridRowCount: true,
      readRowCount: true,
    },
  });

  // Newest per page. A re-read inserts its own row rather than overwriting, so
  // the older ones are history and must not both appear on screen.
  const newest = new Map<number, (typeof proposals)[number]>();
  for (const proposal of proposals) {
    if (!newest.has(proposal.pageNumber)) newest.set(proposal.pageNumber, proposal);
  }

  const sheets = await prisma.planSheetProposal.findMany({
    where: { planId, pageNumber: { in: [...newest.keys()] } },
    orderBy: { createdAt: "desc" },
    select: { pageNumber: true, acceptedSheetNumber: true, proposedSheetNumber: true },
  });
  const sheetNumbers = new Map<number, string | null>();
  for (const sheet of sheets) {
    if (!sheetNumbers.has(sheet.pageNumber)) {
      // The ACCEPTED number where somebody gave one: a person who corrected it
      // is a better source than the reading.
      sheetNumbers.set(sheet.pageNumber, sheet.acceptedSheetNumber ?? sheet.proposedSheetNumber);
    }
  }

  return [...newest.values()]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((proposal) => ({
      id: proposal.id,
      pageNumber: proposal.pageNumber,
      sheetNumber: sheetNumbers.get(proposal.pageNumber) ?? null,
      kind: proposal.kind,
      title: proposal.title,
      rows: isScheduleRowArray(proposal.rows) ? proposal.rows : [],
      reason: proposal.reason,
      confidence: proposal.confidence,
      gridRowCount: proposal.gridRowCount,
      readRowCount: proposal.readRowCount,
    }));
}
