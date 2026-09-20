import { prisma } from "@prova/db";
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "./fringe-schedules-query";
import {
  phaseCodeRollupLine,
  rollUpPhaseCodes,
  type PhaseCodeMeta,
  type PhaseCodeRollup,
  type PhaseCodeRollupLine,
} from "./phase-code-rollup";

/**
 * Assembles the phase-code rollup from real rows.
 *
 * Split from lib/phase-code-rollup.ts for the reason lib/bid-pipeline-query.ts
 * gives: the arithmetic is unit-testable with hand-written inputs, and THIS
 * half — the part that turns database rows into those inputs — is where a
 * Decimal, a null or a soft-deleted row silently becomes the wrong thing.
 *
 * Three conversions here are the whole risk surface, so each is named:
 *
 *   - `quantity` and `budgetedUnitCost` are Prisma Decimals. `Number()` on
 *     a Decimal is exact at these magnitudes; multiplying two Decimals as
 *     strings is not, which is why the multiplication happens after the
 *     conversion and not before.
 *   - `budgetedUnitCost` is NULLABLE and null is not zero. A line nobody
 *     has budgeted contributes null, which the rollup counts as
 *     `linesWithoutBudget` rather than as $0 of budget — the difference
 *     between "budgeted at nothing" and "not budgeted", which a sum cannot
 *     tell apart on its own.
 *   - soft-deleted lines are excluded, matching the model comment on
 *     `JobLineItem.isDeleted` ("excluded from budget/contract totals") and
 *     every other total in this app. Their cost entries go with them: a
 *     line removed by a change order is scope that is no longer in the
 *     budget, and leaving its spend in the actual column while its budget
 *     left would report a variance nobody could reconcile.
 */
export async function loadPhaseCodeRollup(companyId: string): Promise<PhaseCodeRollup> {
  const [phases, lineItems, fringeSchedulesByCraft] = await Promise.all([
    prisma.phaseCode.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    // Scoped through the JOB's companyId, because JobLineItem carries no
    // companyId of its own. Same shape every other cross-job query in this
    // app uses.
    prisma.jobLineItem.findMany({
      where: { isDeleted: false, job: { companyId } },
      select: {
        jobId: true,
        phaseCodeId: true,
        quantity: true,
        budgetedUnitCost: true,
        costEntries: { select: { amount: true } },
        // #287. A cost code's whole purpose is budget-versus-actual on a
        // category of work, and `PhaseCode.tracksLabor` says some of these
        // categories ARE labor — so an actual column fed by cost entries
        // alone reported a labor phase spending nothing and reported it as
        // an underrun.
        timeEntries: { select: TIME_ENTRY_COST_SELECT },
      },
    }),
    loadFringeSchedulesByCraft(companyId),
  ]);

  const meta: PhaseCodeMeta[] = phases.map((phase) => ({
    id: phase.id,
    code: phase.code,
    name: phase.name,
    unit: phase.unit,
    tracksLabor: phase.tracksLabor,
    isActive: phase.isActive,
    sortOrder: phase.sortOrder,
  }));

  // One expression, because the composition that matters — manual cost plus
  // burdened labor, and the hours nobody could price — is `phaseCodeRollupLine`
  // in the pure file next door, where a unit test can reach it. See its
  // docstring for why that one step crossed the split.
  const lines: PhaseCodeRollupLine[] = lineItems.map((item) =>
    phaseCodeRollupLine(item, fringeSchedulesByCraft),
  );

  return rollUpPhaseCodes(meta, lines);
}
