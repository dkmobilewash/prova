import { prisma } from "@prova/db";
import {
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
  const [phases, lineItems] = await Promise.all([
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
      },
    }),
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

  const lines: PhaseCodeRollupLine[] = lineItems.map((item) => ({
    phaseCodeId: item.phaseCodeId,
    jobId: item.jobId,
    budgetedCost:
      item.budgetedUnitCost === null ? null : Number(item.quantity) * Number(item.budgetedUnitCost),
    actualCost: item.costEntries.reduce((sum, entry) => sum + Number(entry.amount), 0),
  }));

  return rollUpPhaseCodes(meta, lines);
}
