import type { Prisma } from "@prova/db";
import {
  openingsFromJson,
  scheduleLines,
  type WallComponentBasis,
  type WallRunInput,
  type WallSchedule,
  type WallTypeInput,
} from "@/lib/wall-assemblies";

/**
 * Keeps a job's estimate lines in step with its wall schedule.
 *
 * The schedule (the runs) is the record of what was measured; the estimate's
 * wall lines are DERIVED from it. Every write to a run calls this inside the
 * same transaction, so the two can never be observed disagreeing.
 *
 * THREE RULES, each a decision rather than a default:
 *
 *  1. UPDATE IN PLACE. A generated line is found by `wallTypeComponentId`, and
 *     only its QUANTITY and LABOR HOURS move. Its id stays, so cost entries and
 *     change-order history keep pointing at it — and a price the estimator
 *     typed over the catalog's stays, because pricing is theirs and measuring
 *     is this function's.
 *  2. CREATE FROM THE CATALOG. A new line takes its price, cost, craft and trade
 *     from the component's catalog entry, exactly as "add from catalog" does,
 *     and says so with `priceBasis: COMPANY_CATALOG` and `sourceCatalogEntryId`.
 *     A component with no catalog entry makes an unpriced line, like a takeoff.
 *  3. SOFT-DELETE WHAT IS GONE. A line whose component no longer appears is set
 *     `isDeleted`, the removal every other estimate path uses, so history keeps
 *     it and totals drop it.
 *
 * Callers guarantee the job is an ESTIMATE and the company's; this function
 * trusts that and touches nothing outside `jobId`.
 */

type Tx = Prisma.TransactionClient;

export type WallSyncSummary = {
  created: number;
  updated: number;
  removed: number;
  unpricedRuns: WallSchedule["unpricedRuns"];
  orphanRuns: WallSchedule["orphanRuns"];
};

const num = (value: { toString(): string } | number | null | undefined): number | null =>
  value == null ? null : Number(value);

/** Everything the schedule needs, read through the transaction client. */
export async function loadWallSchedule(tx: Tx, companyId: string, jobId: string) {
  const runs = await tx.wallRun.findMany({
    where: { jobId, companyId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const typeIds = [...new Set(runs.map((run) => run.wallTypeId))];
  const types = typeIds.length
    ? await tx.wallType.findMany({
        where: { id: { in: typeIds }, companyId },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        include: {
          components: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            include: { catalogEntry: true },
          },
        },
      })
    : [];

  const runInputs: WallRunInput[] = runs.map((run) => ({
    id: run.id,
    label: run.label,
    wallTypeId: run.wallTypeId,
    lengthFt: Number(run.lengthFt),
    heightFt: num(run.heightFt),
    openings: openingsFromJson(run.openings),
  }));
  const typeInputs: WallTypeInput[] = types.map((type) => ({
    id: type.id,
    code: type.code,
    defaultHeightFt: num(type.defaultHeightFt),
    sides: type.sides,
    studSpacingIn: Number(type.studSpacingIn),
    components: type.components.map((component) => ({
      id: component.id,
      description: component.description,
      unit: component.unit,
      basis: component.basis as WallComponentBasis,
      factor: Number(component.factor),
      wastePercent: Number(component.wastePercent),
      roundUp: component.roundUp,
      productionRate: num(component.productionRate),
    })),
  }));
  const componentById = new Map(types.flatMap((type) => type.components).map((c) => [c.id, c]));

  return { runs, runInputs, typeInputs, componentById };
}

export async function syncWallScheduleLines(tx: Tx, companyId: string, jobId: string): Promise<WallSyncSummary> {
  const { runInputs, typeInputs, componentById } = await loadWallSchedule(tx, companyId, jobId);
  const schedule = scheduleLines(runInputs, typeInputs);

  const existing = await tx.jobLineItem.findMany({
    where: { jobId, isDeleted: false, wallTypeComponentId: { not: null } },
    select: { id: true, wallTypeComponentId: true },
  });
  const existingByComponent = new Map(existing.map((line) => [line.wallTypeComponentId as string, line.id]));
  const wanted = new Set(schedule.lines.map((line) => line.componentId));

  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const line of schedule.lines) {
    const laborHours = line.laborHours != null ? line.laborHours.toString() : null;
    const component = componentById.get(line.componentId);
    // #514. The COMPONENT'S rate, not the catalog entry's: the component is
    // the more specific assumption and it is what `scheduleLines` already
    // divided the quantity by to get `laborHours` above, so the two agree by
    // construction rather than by coincidence.
    //
    // WHY STORE IT WHEN THE HOURS ARE ALREADY HERE. The hours are the figure
    // that prices the line; the rate is the figure the actual-productivity
    // back-check compares against (`productionBackCheck` takes an
    // `estimatedRate`, and there is no way back to one from rounded hours and
    // a quantity that may since have changed). Without this, every wall-schedule
    // line — the largest block of labor on a framing bid — was outside that
    // check while every hand-typed line was inside it.
    const productionRate = component?.productionRate != null ? component.productionRate.toString() : null;
    const lineId = existingByComponent.get(line.componentId);
    if (lineId) {
      await tx.jobLineItem.update({
        where: { id: lineId },
        // The rate is re-synced with the hours, deliberately. Both are derived
        // from the component, so writing one and not the other is how a line
        // ends up priced at this month's productivity and back-checked against
        // last month's.
        data: { quantity: line.quantity.toString(), laborHours, productionRate },
      });
      updated += 1;
      continue;
    }
    const entry = component?.catalogEntry ?? null;
    await tx.jobLineItem.create({
      data: {
        jobId,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity.toString(),
        laborHours,
        productionRate,
        unitPrice: entry?.defaultUnitPrice ?? null,
        budgetedUnitCost: entry?.defaultBudgetedUnitCost ?? null,
        currentEstimatedUnitCost: entry?.defaultBudgetedUnitCost ?? null,
        tradeScope: entry?.tradeScope ?? null,
        craftClassificationId: component?.craftClassificationId ?? entry?.craftClassificationId ?? null,
        sourceCatalogEntryId: entry?.id ?? null,
        priceBasis: entry ? "COMPANY_CATALOG" : null,
        wallTypeComponentId: line.componentId,
      },
    });
    created += 1;
  }

  for (const line of existing) {
    if (!wanted.has(line.wallTypeComponentId as string)) {
      await tx.jobLineItem.update({ where: { id: line.id }, data: { isDeleted: true } });
      removed += 1;
    }
  }

  return { created, updated, removed, unpricedRuns: schedule.unpricedRuns, orphanRuns: schedule.orphanRuns };
}
