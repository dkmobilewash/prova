import { prisma } from "@prova/db";
import { buildOurSide, MAX_PRICED_LINES, type OurSide } from "./ourSide";

/**
 * Read our side of the deal for a job: its proposal clauses, the distinct
 * descriptions of its live line items, and the lines of the bid it was WON
 * from. `wonJobId` alone does not mean won — the schema records the bug where
 * code skipped the status — so both are required.
 *
 * Reads only, straight through Prisma; nothing in lib/estimating is called.
 */
export async function loadOurSide(jobId: string, companyId: string): Promise<OurSide> {
  const [clauses, lines, bid] = await Promise.all([
    prisma.jobProposalClause.findMany({
      where: { jobId, job: { companyId } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, kind: true, text: true },
    }),
    prisma.jobLineItem.findMany({
      where: { jobId, isDeleted: false, job: { companyId } },
      orderBy: { createdAt: "asc" },
      distinct: ["description"],
      take: MAX_PRICED_LINES,
      select: { description: true },
    }),
    prisma.bidInvitation.findFirst({
      where: { companyId, wonJobId: jobId, status: "WON" },
      select: { lines: { orderBy: { sortOrder: "asc" }, select: { kind: true, label: true, description: true, accepted: true } } },
    }),
  ]);
  return buildOurSide(
    clauses,
    lines.map((line) => line.description),
    bid?.lines ?? [],
  );
}
