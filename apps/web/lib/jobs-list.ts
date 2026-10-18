import { prisma, type Prisma } from "@prova/db";

/**
 * The one job read behind home's job cards and the /jobs list, so the two
 * cannot disagree about what a job's value or stage is.
 */
export async function loadJobs(where: Prisma.JobWhereInput) {
  return prisma.job.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      contact: true,
      lineItems: { where: { isDeleted: false } },
      signatureRequests: { select: { status: true } },
      invoices: { select: { amount: true } },
    },
  });
}

export type JobRow = Awaited<ReturnType<typeof loadJobs>>[number];

export function jobValue(job: JobRow) {
  return job.lineItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice ?? 0), 0);
}
