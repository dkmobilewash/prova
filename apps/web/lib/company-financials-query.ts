import { prisma } from "@prova/db";
import { calculateJobWip, calculateLineItemWip } from "./wip";
import { loadRetainageHeld } from "./retainage-query";
import { calculateCompanyFinancials, type CompanyFinancials } from "./company-financials";
import { lineItemCostToDate, unassignedLaborCost } from "./labor-job-cost";
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "./fringe-schedules-query";

/**
 * Loads what the company-wide figures need, and computes them.
 *
 * Kept apart from company-financials.ts so the arithmetic there stays pure
 * and testable without a database — the same split lib/wip.ts uses.
 *
 * "Active" means contracted or in progress. Estimates are not backlog
 * until someone has signed them, and a completed job is not what the
 * business is carrying.
 *
 * That status filter is for BACKLOG AND MARGIN ONLY. Retainage is
 * deliberately not drawn from it and is not computed here at all — see
 * lib/retainage-query.ts, which owns that population. Reusing this job
 * list for retainage is issue #97, and issue #46 before it: retainage
 * comes back at closeout, when a job is COMPLETE and this filter has
 * already dropped it.
 */
export async function loadCompanyFinancials(companyId: string): Promise<CompanyFinancials> {
  const [jobs, paymentTotal, invoiceTotal, retainageHeld, fringeSchedulesByCraft] = await Promise.all([
    prisma.job.findMany({
      where: { companyId, status: { in: ["CONTRACTED", "IN_PROGRESS"] } },
      select: {
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
        // Hours are job cost (issue #287). Fetched per job rather than per
        // line because TimeEntry.lineItemId is nullable and the log form's
        // default is "No specific line" -- the unattached ones are real
        // spend and a line-scoped fetch would never see them.
        timeEntries: { select: TIME_ENTRY_COST_SELECT },
        // amount only, for billedToDate. This file no longer names the
        // retainage column at all, and lib/retainage-single-source.test.ts
        // enforces that it stays that way.
        invoices: { select: { amount: true } },
      },
    }),
    prisma.payment.aggregate({
      where: { invoice: { job: { companyId } } },
      _sum: { amount: true },
    }),
    prisma.invoice.aggregate({
      where: { job: { companyId } },
      _sum: { amount: true },
    }),
    loadRetainageHeld(companyId),
    loadFringeSchedulesByCraft(companyId),
  ]);

  const wipByJob = jobs.map((job) => {
    const lineItems = job.lineItems.map((line) =>
      calculateLineItemWip({
        quantity: Number(line.quantity),
        unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
        budgetedUnitCost: line.budgetedUnitCost === null ? null : Number(line.budgetedUnitCost),
        currentEstimatedUnitCost:
          line.currentEstimatedUnitCost === null ? null : Number(line.currentEstimatedUnitCost),
        estimatedCostToComplete:
          line.estimatedCostToComplete === null ? null : Number(line.estimatedCostToComplete),
        ...lineItemCostToDate(line.id, line.costEntries, job.timeEntries, fringeSchedulesByCraft),
      }),
    );
    const billedToDate = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
    return calculateJobWip(
      lineItems,
      billedToDate,
      unassignedLaborCost(job.timeEntries, fringeSchedulesByCraft),
    );
  });

  return calculateCompanyFinancials({
    jobs: wipByJob,
    cashCollected: Number(paymentTotal._sum.amount ?? 0),
    totalBilled: Number(invoiceTotal._sum.amount ?? 0),
    retainageHeld,
  });
}
