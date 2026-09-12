import { prisma } from "@prova/db";
import { calculateLineItemWip } from "./wip";
import { changeOrderValueDelta, type LineItemForChangeOrder } from "./change-order";
import { buildWipSchedule, type WipSchedule, type WipScheduleJobInput } from "./wip-schedule";

/**
 * Loads what the WIP schedule needs, and composes it.
 *
 * Kept apart from lib/wip-schedule.ts so the arithmetic there stays pure and
 * testable without a database — the same split lib/wip.ts and
 * lib/company-financials-query.ts already use.
 *
 * THE POPULATION IS THE SAME "ACTIVE" ONE THE BACKLOG FIGURE USES —
 * CONTRACTED and IN_PROGRESS. That is deliberate and it is a fact a person
 * can check: the schedule's revised-contract total equals the backlog figure
 * on the metric bar, because both are summed over the same jobs from the
 * same line items. Two company-wide contract-value figures that disagree is
 * exactly the failure this codebase keeps paying for.
 *
 * An ESTIMATE is not work in progress — nobody has signed it — and a
 * COMPLETE job is not what the business is carrying. A full surety schedule
 * often also lists jobs COMPLETED DURING THE PERIOD, which this does not:
 * that needs a period to be chosen and a completion date to be reliable on
 * every job, and neither is settled here. It is a stated gap rather than an
 * approximation.
 */
export async function loadWipSchedule(companyId: string): Promise<WipSchedule> {
  const jobs = await prisma.job.findMany({
    where: { companyId, status: { in: ["CONTRACTED", "IN_PROGRESS"] } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      contact: { select: { name: true } },
      // UNFILTERED on purpose, and read once for two jobs. The WIP math
      // below takes the live lines only; the change-order calculation needs
      // the deleted ones too, because an unapplied EDIT or REMOVE is valued
      // against the live row and an earlier change order may already have
      // soft-deleted it. The job page reads it the same unfiltered way for
      // the same reason. Filtering here and reading again for the targets
      // would be two queries that can disagree.
      lineItems: {
        select: {
          id: true,
          isDeleted: true,
          quantity: true,
          unitPrice: true,
          budgetedUnitCost: true,
          currentEstimatedUnitCost: true,
          estimatedCostToComplete: true,
          costEntries: { select: { amount: true } },
        },
      },
      changeOrders: {
        where: { status: "APPROVED" },
        select: {
          proposals: {
            select: {
              changeType: true,
              lineItemId: true,
              quantity: true,
              unitPrice: true,
              previousQuantity: true,
              previousUnitPrice: true,
              previousIsDeleted: true,
            },
          },
        },
      },
      // amount only — billedToDate. Retainage is a separate population and a
      // separate file (lib/retainage-query.ts); naming its column here is
      // what lib/retainage-single-source.test.ts exists to prevent.
      invoices: { select: { amount: true } },
    },
  });

  const inputs: WipScheduleJobInput[] = jobs.map((job) => {
    const lineItems = job.lineItems
      .filter((line) => !line.isDeleted)
      .map((line) =>
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

    const targets = new Map<string, LineItemForChangeOrder>(
      job.lineItems.map((item) => [item.id, item]),
    );

    const approvedProposals = job.changeOrders.flatMap((co) => co.proposals);
    const approvedChangeOrderValue = job.changeOrders.reduce(
      (sum, co) => sum + Number(changeOrderValueDelta(co.proposals, targets)),
      0,
    );

    // An approved EDIT or REMOVE with no snapshot of what it replaced.
    // changeOrderValueDelta has to value those at zero — the live row IS the
    // proposal by then, so measuring against it compares a number with
    // itself — which would silently overstate the original contract value.
    // Counted so the schedule can blank the split rather than guess it. An
    // ADD never carries a snapshot and never needs one: its own quantity and
    // price ARE the delta.
    const unestablishedApprovedProposals = approvedProposals.filter(
      (proposal) => proposal.changeType !== "ADD" && proposal.previousIsDeleted === null,
    ).length;

    return {
      jobId: job.id,
      jobName: job.name,
      customerName: job.contact.name,
      status: job.status,
      lineItems,
      billedToDate: job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0),
      approvedChangeOrderValue,
      unestablishedApprovedProposals,
    };
  });

  return buildWipSchedule(inputs);
}
