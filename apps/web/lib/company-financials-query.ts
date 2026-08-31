import { prisma } from "@prova/db";
import { calculateJobWip, calculateLineItemWip } from "./wip";
import { calculateRetainageSummary } from "./retainage";
import { calculateCompanyFinancials, type CompanyFinancials } from "./company-financials";

/**
 * Loads what the company-wide figures need, and computes them.
 *
 * Kept apart from company-financials.ts so the arithmetic there stays pure
 * and testable without a database — the same split lib/wip.ts uses.
 *
 * "Active" means contracted or in progress. Estimates are not backlog
 * until someone has signed them, and a completed job is not what the
 * business is carrying.
 */
export async function loadCompanyFinancials(companyId: string): Promise<CompanyFinancials> {
  const [jobs, paymentTotal, invoiceTotal] = await Promise.all([
    prisma.job.findMany({
      where: { companyId, status: { in: ["CONTRACTED", "IN_PROGRESS"] } },
      select: {
        substantialCompletionDate: true,
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
        invoices: { select: { amount: true, retainageWithheld: true } },
        retainageReleases: { select: { amount: true } },
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
        actualCostToDate: line.costEntries.reduce((sum, cost) => sum + Number(cost.amount), 0),
      }),
    );
    const billedToDate = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
    return calculateJobWip(lineItems, billedToDate);
  });

  const retainageBalances = jobs.map(
    (job) =>
      calculateRetainageSummary({
        invoiceRetainageWithheld: job.invoices.map((invoice) =>
          invoice.retainageWithheld === null ? null : Number(invoice.retainageWithheld),
        ),
        releaseAmounts: job.retainageReleases.map((release) => Number(release.amount)),
        substantialCompletionDate: job.substantialCompletionDate,
      }).balance,
  );

  return calculateCompanyFinancials({
    jobs: wipByJob,
    cashCollected: Number(paymentTotal._sum.amount ?? 0),
    totalBilled: Number(invoiceTotal._sum.amount ?? 0),
    retainageBalances,
  });
}
