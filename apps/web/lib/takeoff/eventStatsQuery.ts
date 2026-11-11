import { prisma } from "@prova/db";
import { jobAutomation, type JobAutomation } from "./eventStats";

export type JobAutomationRow = { jobId: string; name: string; createdAt: Date; firstUploadAt: Date | null } & JobAutomation;

/**
 * Every real job of ONE company with its automation figures (`eventStats.ts`),
 * newest first. Scoped by company in the read itself; the sample job is left out.
 */
export async function loadJobAutomation(companyId: string): Promise<JobAutomationRow[]> {
  const jobs = await prisma.job.findMany({
    where: { companyId, isSample: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      takeoffPlans: { orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
      takeoffEvents: { select: { kind: true, target: true, batch: true, createdAt: true } },
    },
  });
  return jobs.map((job) => {
    const firstUploadAt = job.takeoffPlans[0]?.createdAt ?? null;
    return { jobId: job.id, name: job.name, createdAt: job.createdAt, firstUploadAt, ...jobAutomation(job.takeoffEvents, firstUploadAt) };
  });
}
