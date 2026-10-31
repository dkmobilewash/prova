import { prisma } from "@prova/db";

/**
 * A job's spec book: the sections of the bid it was won from, read through
 * `BidInvitation.wonJobId` and never copied, plus any uploaded to the job
 * directly. It only ever holds what somebody uploaded, so a caller must not
 * present it as the whole book.
 */
export async function loadJobSpecSections(jobId: string, companyId: string) {
  return prisma.bidSpecSection.findMany({
    where: {
      OR: [
        { job: { id: jobId, companyId } },
        { bidInvitation: { wonJobId: jobId, companyId } },
      ],
    },
    orderBy: { sectionNumber: "asc" },
    select: {
      id: true,
      sectionNumber: true,
      title: true,
      fileName: true,
      fileUrl: true,
      jobId: true,
      submittalReadings: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true, _count: { select: { proposals: true } } },
      },
    },
  });
}
