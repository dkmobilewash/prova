import { prisma } from "@prova/db";
import { calculateJobWip, calculateLineItemWip } from "./wip";
import { wipScheduleTable, type WipScheduleJob, type WipScheduleRow } from "./wip-schedule";

/**
 * Loads the WIP schedule for a company.
 *
 * Deliberately the same shape as lib/company-financials-query.ts, which
 * already does this loop for the metric bar — line items through
 * `calculateLineItemWip`, invoices summed for billedToDate, the pair handed
 * to `calculateJobWip`. The difference is that this one keeps the job's
 * IDENTITY, which that one drops because it only sums.
 *
 * They are not merged. That file's own header explains why a shared job
 * list is dangerous here: reusing its population for retainage was issue
 * #97, and issue #46 before it. Two callers wanting per-job WIP is not
 * enough reason to give them one query whose filter then has to be right
 * for both.
 *
 * WHICH JOBS, and it is a real decision rather than a default.
 * CONTRACTED and IN_PROGRESS. An ESTIMATE is not work in progress — nobody
 * has signed it — and a COMPLETE job is finished work whose percentage is
 * 100 and whose over/under position has resolved. This matches the backlog
 * definition next door, and the export names the filter on screen so a
 * reader knows what is in the file rather than inferring it.
 *
 * IF YOU ARE COPYING THIS FILTER, STOP AND READ #97 FIRST. It is right for
 * percentage-of-completion and wrong for anything that outlives closeout —
 * retainage above all, which is exactly the money a COMPLETE job is still
 * owed. lib/retainage-query.ts owns that population and this file does not
 * touch retainage at all.
 */
export async function loadWipSchedule(companyId: string): Promise<WipScheduleRow[]> {
  const jobs = await prisma.job.findMany({
    where: { companyId, status: { in: ["CONTRACTED", "IN_PROGRESS"] } },
    orderBy: { name: "asc" },
    select: {
      name: true,
      status: true,
      contact: { select: { name: true } },
      lineItems: {
        where: { isDeleted: false },
        select: {
          quantity: true,
          unitPrice: true,
          budgetedUnitCost: true,
          currentEstimatedUnitCost: true,
          estimatedCostToComplete: true,
          costEntries: { select: { amount: true } },
        },
      },
      // amount only. Naming the retainage column here would put this file
      // in the way of lib/retainage-single-source.test.ts, and correctly so
      // -- see the header.
      invoices: { select: { amount: true } },
    },
  });

  const scheduleJobs: WipScheduleJob[] = jobs.map((job) => {
    const lineItems = job.lineItems.map((line) =>
      calculateLineItemWip({
        quantity: Number(line.quantity),
        unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
        budgetedUnitCost: line.budgetedUnitCost === null ? null : Number(line.budgetedUnitCost),
        currentEstimatedUnitCost:
          line.currentEstimatedUnitCost === null ? null : Number(line.currentEstimatedUnitCost),
        estimatedCostToComplete:
          line.estimatedCostToComplete === null ? null : Number(line.estimatedCostToComplete),
        actualCostToDate: line.costEntries.reduce((sum, cost) => sum + Number(cost.amount), 0),
      }),
    );
    const billedToDate = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);

    return {
      name: job.name,
      customer: job.contact.name,
      status: job.status,
      wip: calculateJobWip(lineItems, billedToDate),
    };
  });

  return wipScheduleTable(scheduleJobs);
}
