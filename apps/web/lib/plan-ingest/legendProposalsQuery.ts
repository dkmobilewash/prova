import { prisma } from "@prova/db";
import { sightFieldsFor, storedCropsFromJson, storedLegendTypesFromJson, type StoredCrop, type StoredLegendType } from "@/lib/takeoff/legendProposal";

/** One legend page's read, as the review screen shows it. */
export type LegendProposalView = {
  id: string;
  planId: string;
  pageNumber: number;
  sheetTitle: string | null;
  sheetNumber: string | null;
  types: StoredLegendType[];
  crops: StoredCrop[];
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** True once the drawing has been read too; the merged types then carry both. */
  hasSight: boolean;
  /** The sight read's height note per code (upper-cased), for the height reading before Add. */
  heightNotes: Record<string, string | null>;
  status: "PROPOSED" | "ACCEPTED" | "REJECTED";
};

/** The newest read of each legend page on a plan set, first page first. */
export async function loadLegendProposals(planId: string): Promise<LegendProposalView[]> {
  const proposals = await prisma.planLegendProposal.findMany({
    where: { planId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      pageNumber: true,
      sheetTitle: true,
      merged: true,
      crops: true,
      sightRead: true,
      reason: true,
      confidence: true,
      status: true,
    },
  });
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
    if (!sheetNumbers.has(sheet.pageNumber)) sheetNumbers.set(sheet.pageNumber, sheet.acceptedSheetNumber ?? sheet.proposedSheetNumber);
  }
  return [...newest.values()]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((proposal) => ({
      id: proposal.id,
      planId,
      pageNumber: proposal.pageNumber,
      sheetTitle: proposal.sheetTitle,
      sheetNumber: sheetNumbers.get(proposal.pageNumber) ?? null,
      types: storedLegendTypesFromJson(proposal.merged),
      crops: storedCropsFromJson(proposal.crops),
      reason: proposal.reason,
      confidence: proposal.confidence,
      hasSight: proposal.sightRead !== null,
      heightNotes: Object.fromEntries(
        storedLegendTypesFromJson(proposal.merged).map((t) => [t.code.toUpperCase(), sightFieldsFor(proposal.sightRead, t.code).heightNote]),
      ),
      status: proposal.status,
    }));
}

/** How many wall types the newest legend reads on a set define — the number the takeoff tab's link carries. */
export async function legendTypeCountFor(planId: string): Promise<number> {
  const proposals = await loadLegendProposals(planId);
  return proposals.reduce((n, p) => n + p.types.length, 0);
}
