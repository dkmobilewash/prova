import { loadEmployerBurdenRates } from "./employer-burden-query";
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "./fringe-schedules-query";
import { lineItemCostToDate, unassignedLaborCost } from "./labor-job-cost";
import { calculateJobWip, calculateLineItemWip } from "./wip";

/**
 * Turning a job's rows into its WIP figures — in ONE place.
 *
 * `bid-outcome-query.ts` already says the important half of this: the cost
 * arithmetic is `loadWipSchedule`'s, line for line, "and that is the point
 * rather than an accident… If this file added its own total, 'what the job
 * cost' would mean one thing on the WIP schedule and another beside the bid,
 * and there would be no way to tell which was right."
 *
 * That file could not simply call `loadWipSchedule`, which filters to
 * CONTRACTED and IN_PROGRESS and so excludes the COMPLETE jobs a settled bid
 * needs — so it repeated the mapping. The conceptual-estimate benchmark needs
 * the same COMPLETE jobs for the same reason, and a THIRD copy is where a
 * mapping starts to drift. Extracted rather than copied again.
 *
 * The query SHAPE still differs per caller and should: one starts from bids,
 * one from jobs. Only the select fragment and the arithmetic are shared.
 */
export const JOB_WIP_SELECT = {
  lineItems: {
    where: { isDeleted: false },
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      budgetedUnitCost: true,
      currentEstimatedUnitCost: true,
      estimatedCostToComplete: true,
      costEntries: { select: { amount: true } },
    },
  },
  invoices: { select: { amount: true } },
  timeEntries: { select: TIME_ENTRY_COST_SELECT },
} as const;

type Decimalish = { toString(): string };

type JobWipRows = {
  lineItems: {
    id: string;
    quantity: Decimalish;
    unitPrice: Decimalish | null;
    budgetedUnitCost: Decimalish | null;
    currentEstimatedUnitCost: Decimalish | null;
    estimatedCostToComplete: Decimalish | null;
    costEntries: { amount: Decimalish }[];
  }[];
  invoices: { amount: Decimalish }[];
  timeEntries: Parameters<typeof unassignedLaborCost>[0];
};

/** Both rate tables, loaded once for a batch of jobs. */
export async function loadJobWipRates(companyId: string) {
  const [fringeSchedulesByCraft, employerBurdenRates] = await Promise.all([
    loadFringeSchedulesByCraft(companyId),
    loadEmployerBurdenRates(companyId),
  ]);
  return { fringeSchedulesByCraft, employerBurdenRates };
}

export type JobWipRates = Awaited<ReturnType<typeof loadJobWipRates>>;

export function wipFromJobRows(job: JobWipRows, rates: JobWipRates) {
  const lineItems = job.lineItems.map((line) =>
    calculateLineItemWip({
      quantity: Number(line.quantity),
      unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
      budgetedUnitCost: line.budgetedUnitCost === null ? null : Number(line.budgetedUnitCost),
      currentEstimatedUnitCost:
        line.currentEstimatedUnitCost === null ? null : Number(line.currentEstimatedUnitCost),
      estimatedCostToComplete:
        line.estimatedCostToComplete === null ? null : Number(line.estimatedCostToComplete),
      ...lineItemCostToDate(
        line.id,
        line.costEntries,
        job.timeEntries,
        rates.fringeSchedulesByCraft,
        rates.employerBurdenRates,
      ),
    }),
  );
  const billedToDate = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  return calculateJobWip(
    lineItems,
    billedToDate,
    unassignedLaborCost(job.timeEntries, rates.fringeSchedulesByCraft, rates.employerBurdenRates),
  );
}
