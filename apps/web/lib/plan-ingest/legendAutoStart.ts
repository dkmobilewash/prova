import { prisma } from "@prova/db";
import { aiGate } from "@/lib/ai/settings";

/**
 * ── THE LEGEND READ STARTS ITSELF ──
 *
 * The WALL_LEGEND stage only ever started from a button that appears after a
 * pass has finished (`PlanIngestPanel`), so a set nobody pressed it on had no
 * legend, and every wall's type had to come from a tag printed beside it: the
 * held-out new-build sets measured 0% typed (2026-11-05) with no legend ever
 * read. A customer who uploads a set and finds the walls would get the same.
 *
 * So the run is queued for them, once per set, wherever the set's free pass
 * is known to be done — when that pass closes, and when the takeoff page
 * opens on a set inventoried before this existed — and the cron drain
 * (`/api/plan-ingest/run`) reads it with no page open. Only with the
 * company's plan-reading AI on: the read is a model call per legend page,
 * metered like the button's. Never twice: a set that has a stored legend, or
 * has ever had a WALL_LEGEND run (finished, failed or under way), is left
 * alone, so a person who removed a legend is not overruled and nothing is
 * paid for twice.
 */
export async function queueLegendRead(input: { planId: string; companyId: string; startedByUserId: string | null }): Promise<"queued" | "ai-off" | "already" | "not-inventoried"> {
  const { planId, companyId } = input;
  const inventory = await prisma.planIngestJob.findFirst({
    where: { planId, stage: "PAGE_INVENTORY", finishedAt: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { pageCount: true },
  });
  if (inventory === null || inventory.pageCount < 1) return "not-inventoried";
  const [run, legend] = await Promise.all([
    prisma.planIngestJob.findFirst({ where: { planId, stage: "WALL_LEGEND" }, select: { id: true } }),
    prisma.planLegendProposal.findFirst({ where: { planId }, select: { id: true } }),
  ]);
  if (run !== null || legend !== null) return "already";
  if (!(await aiGate(companyId, "PLAN_TEXT_READ")).ok) return "ai-off";
  await prisma.$transaction(async (tx) => {
    const job = await tx.planIngestJob.create({
      data: { planId, companyId, stage: "WALL_LEGEND", pageCount: inventory.pageCount, startedByUserId: input.startedByUserId },
      select: { id: true },
    });
    await tx.planIngestTask.createMany({
      data: Array.from({ length: inventory.pageCount }, (_, at) => ({ jobId: job.id, pageNumber: at + 1, stage: "WALL_LEGEND" as const })),
    });
  });
  return "queued";
}
