import { prisma } from "@prova/db";

import { toJobOption } from "@/components/jobLabels";

import { bidOutcome, type BidOutcome } from "./bid-outcome";
import { loadEmployerBurdenRates } from "./employer-burden-query";
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "./fringe-schedules-query";
import { lineItemCostToDate, unassignedLaborCost } from "./labor-job-cost";
import { calculateJobWip, calculateLineItemWip } from "./wip";

/**
 * What each linked bid's job has actually cost.
 *
 * THE COST ARITHMETIC IS `loadWipSchedule`'s, LINE FOR LINE, and that is the
 * point rather than an accident: `calculateLineItemWip` per line with
 * `lineItemCostToDate`, invoices summed, the pair handed to `calculateJobWip`
 * with `unassignedLaborCost`. If this file added its own total, "what the job
 * cost" would mean one thing on the WIP schedule and another beside the bid,
 * and there would be no way to tell which was right.
 *
 * It cannot simply CALL `loadWipSchedule`, which filters to CONTRACTED and
 * IN_PROGRESS — precisely excluding the COMPLETE jobs a settled bid needs.
 * The duplication is the query shape, never the arithmetic.
 */
export type LinkedBidOutcome = {
  bidInvitationId: string;
  jobId: string;
  jobName: string;
  jobStatus: string;
  outcome: BidOutcome;
};

export async function loadBidOutcomes(companyId: string): Promise<Map<string, LinkedBidOutcome>> {
  const [bids, fringeSchedulesByCraft, employerBurdenRates] = await Promise.all([
    prisma.bidInvitation.findMany({
      where: { companyId, wonJobId: { not: null } },
      select: {
        id: true,
        bidAmount: true,
        wonJob: {
          select: {
            id: true,
            name: true,
            status: true,
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
          },
        },
      },
    }),
    loadFringeSchedulesByCraft(companyId),
    loadEmployerBurdenRates(companyId),
  ]);

  const byBid = new Map<string, LinkedBidOutcome>();
  for (const bid of bids) {
    const job = bid.wonJob;
    // The FK is SET NULL, so this cannot normally be null while the filter
    // above holds — but a row read between a job delete and its cascade is
    // not evidence of anything, and skipping is cheaper than asserting.
    if (!job) continue;

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
          fringeSchedulesByCraft,
          employerBurdenRates,
        ),
      }),
    );
    const billedToDate = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
    const wip = calculateJobWip(
      lineItems,
      billedToDate,
      unassignedLaborCost(job.timeEntries, fringeSchedulesByCraft, employerBurdenRates),
    );

    byBid.set(bid.id, {
      bidInvitationId: bid.id,
      jobId: job.id,
      jobName: job.name,
      jobStatus: job.status,
      outcome: bidOutcome({
        bidAmount: bid.bidAmount === null ? null : Number(bid.bidAmount),
        jobStatus: job.status,
        contractValue: wip.contractValue,
        actualCostToDate: wip.actualCostToDate,
        percentComplete: wip.percentComplete,
      }),
    });
  }
  return byBid;
}

/** The jobs a bid could be linked to: this company's, newest first, with the
 * ones already claimed by another bid marked so the picker can say why they
 * cannot be chosen rather than silently omitting them. */
export async function loadLinkableJobs(companyId: string) {
  const [jobs, claimed] = await Promise.all([
    prisma.job.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      // status and contact are what `jobPickerLabel` needs: issue #65 was
      // fifteen jobs, seven called "Smith kitchen remodel", and every picker
      // showing seven identical rows. This picker decides which job's COSTS a
      // bid is judged against, so picking the wrong one teaches the wrong
      // lesson.
      select: { id: true, name: true, status: true, contact: { select: { name: true } } },
      take: 200,
    }),
    prisma.bidInvitation.findMany({
      where: { companyId, wonJobId: { not: null } },
      select: { wonJobId: true, id: true },
    }),
  ]);
  const claimedBy = new Map(claimed.map((c) => [c.wonJobId as string, c.id]));
  return jobs.map((job) => ({ ...toJobOption(job), claimedByBidId: claimedBy.get(job.id) ?? null }));
}
