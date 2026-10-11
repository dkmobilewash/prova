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

  // ── DELETED LINES ARE READ TOO, AND THAT IS THE WHOLE FIX ──
  //
  // Reported from the app: delete a wall-schedule line and it comes back. It
  // came back because this read only `isDeleted: false`, so a line somebody
  // had removed was invisible here and the loop below created a fresh one —
  // at catalog prices, losing whatever had been typed on it.
  //
  // THE TWO KINDS OF DELETION ARE TOLD APART WITHOUT A NEW COLUMN, because
  // this function is the only other thing that deletes one, and it does so in
  // exactly one circumstance: the component is no longer in the schedule. So
  // when it retires a line it RELEASES the component link (below), and the
  // rule falls out:
  //
  //   deleted, still linked to its component  ->  a PERSON removed it. Leave it.
  //   deleted, link released                  ->  this function retired it.
  //                                               Build a new one if the
  //                                               component comes back.
  //
  // A person who wants the line back adds it by hand, or changes the wall type,
  // which is where a derived line's existence is actually decided.
  const existing = await tx.jobLineItem.findMany({
    where: { jobId, wallTypeComponentId: { not: null } },
    select: { id: true, wallTypeComponentId: true, isDeleted: true },
  });
  const liveByComponent = new Map(
    existing.filter((line) => !line.isDeleted).map((line) => [line.wallTypeComponentId as string, line.id]),
  );
  const removedByHand = new Set(
    existing.filter((line) => line.isDeleted).map((line) => line.wallTypeComponentId as string),
  );
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
    const lineId = liveByComponent.get(line.componentId);
    if (lineId) {
      await tx.jobLineItem.update({
        where: { id: lineId },
        // The rate is re-synced with the hours, deliberately. Both are derived
        // from the component, so writing one and not the other is how a line
        // ends up priced at this month's productivity and back-checked against
        // last month's.
        //
        // AND THE PRICE IS DELIBERATELY NOT HERE — stated because #515 read the
        // omission and could not tell whether it was a choice. `unitPrice` and
        // `budgetedUnitCost` are written when the line is CREATED and never
        // again: a re-sync happens whenever a run's length or a type's layers
        // change, and an estimator who has adjusted a price on this bid must not
        // lose it to a recalibration. The quantity and the labour are geometry
        // and are the schedule's to own; the price, once it exists, is the
        // estimator's. A line that should be repriced is one somebody deletes.
        data: { quantity: line.quantity.toString(), laborHours, productionRate },
      });
      updated += 1;
      continue;
    }
    // SOMEBODY REMOVED THIS ONE. Putting it back is the bug this function
    // was reported for; their decision outlives a re-sync.
    if (removedByHand.has(line.componentId)) continue;

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
        // #513, and the precedence is the same as the craft's directly below:
        // the COMPONENT first, its catalog entry second. A wall type is the one
        // place a cost type is knowable up front — board and studs are material,
        // hang-and-finish is labor — and the component is the more specific
        // statement of it. Neither set means uncoded, and `bid-recap.ts` reports
        // that and marks it up at nothing rather than picking a default.
        costCategory: component?.costCategory ?? entry?.costCategory ?? null,
        craftClassificationId: component?.craftClassificationId ?? entry?.craftClassificationId ?? null,
        sourceCatalogEntryId: entry?.id ?? null,
        priceBasis: entry ? "COMPANY_CATALOG" : null,
        wallTypeComponentId: line.componentId,
      },
    });
    created += 1;
  }

  for (const line of existing) {
    if (line.isDeleted) continue;
    if (!wanted.has(line.wallTypeComponentId as string)) {
      // THE LINK IS RELEASED ALONG WITH THE LINE, and that is what makes this
      // function's own deletions distinguishable from a person's. A line
      // retired here is one whose component left the schedule; if that
      // component comes back, a fresh line should come with it. A line a
      // PERSON deleted keeps its link and is left alone above.
      await tx.jobLineItem.update({
        where: { id: line.id },
        data: { isDeleted: true, wallTypeComponentId: null },
      });
      removed += 1;
    }
  }

  return { created, updated, removed, unpricedRuns: schedule.unpricedRuns, orphanRuns: schedule.orphanRuns };
}
