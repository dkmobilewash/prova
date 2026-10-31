import { prisma } from "@prova/db";
import type { ReadSection } from "@/lib/buyout-spec-check";
import { findingsFromJson } from "@/lib/specs/spec-findings";

/** The newest reading of each section of the bid this job was won from. A job
 * with no winning bid has none, because the cost reader reads bids only. */
export async function loadJobSpecFindings(jobId: string, companyId: string): Promise<ReadSection[]> {
  const sections = await prisma.bidSpecSection.findMany({
    where: { bidInvitation: { wonJobId: jobId, companyId } },
    orderBy: { sectionNumber: "asc" },
    select: {
      sectionNumber: true,
      readings: { orderBy: { createdAt: "desc" }, take: 1, select: { findings: true } },
    },
  });
  return sections.flatMap((section) =>
    section.readings[0]
      ? [{ sectionNumber: section.sectionNumber, findings: findingsFromJson(section.readings[0].findings) }]
      : [],
  );
}
