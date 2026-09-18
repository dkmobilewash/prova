import { prisma } from "@prova/db";
import type { FringeRateScheduleInput } from "./labor-cost";

/**
 * Every fringe rate schedule a company has, grouped by craft classification
 * and converted out of Prisma's Decimal.
 *
 * One query for the whole company rather than per craft or per job: the
 * company-wide WIP surfaces (the metric bar, the WIP schedule export) price
 * every active job in one pass, and a per-job fetch would be a query per job.
 *
 * Scoped on `FringeRateSchedule.companyId` directly — the column exists and
 * is indexed — rather than by walking CraftClassification, so a schedule
 * cannot arrive through a craft that belongs to somebody else.
 *
 * NOT ordered for correctness. `findEffectiveFringeRateSchedule` stopped
 * depending on array order at #104 finding 3; the order here is for a human
 * reading the list.
 */
export async function loadFringeSchedulesByCraft(
  companyId: string,
): Promise<Map<string, FringeRateScheduleInput[]>> {
  const schedules = await prisma.fringeRateSchedule.findMany({
    where: { companyId },
    orderBy: { effectiveFrom: "desc" },
    select: {
      craftClassificationId: true,
      baseWage: true,
      pensionRate: true,
      vacationRate: true,
      healthWelfareRate: true,
      trainingRate: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });

  const byCraft = new Map<string, FringeRateScheduleInput[]>();
  for (const schedule of schedules) {
    const list = byCraft.get(schedule.craftClassificationId) ?? [];
    list.push({
      baseWage: Number(schedule.baseWage),
      pensionRate: schedule.pensionRate == null ? null : Number(schedule.pensionRate),
      vacationRate: schedule.vacationRate == null ? null : Number(schedule.vacationRate),
      healthWelfareRate:
        schedule.healthWelfareRate == null ? null : Number(schedule.healthWelfareRate),
      trainingRate: schedule.trainingRate == null ? null : Number(schedule.trainingRate),
      effectiveFrom: schedule.effectiveFrom,
      effectiveTo: schedule.effectiveTo,
    });
    byCraft.set(schedule.craftClassificationId, list);
  }
  return byCraft;
}

/** The TimeEntry columns burdened job costing needs, as a Prisma `select`.
 * Shared by the two company-wide WIP queries so they cannot fetch different
 * halves of the same calculation. */
export const TIME_ENTRY_COST_SELECT = {
  lineItemId: true,
  craftClassificationId: true,
  date: true,
  hours: true,
  payType: true,
  perDiemAmount: true,
  travelPayAmount: true,
} as const;
