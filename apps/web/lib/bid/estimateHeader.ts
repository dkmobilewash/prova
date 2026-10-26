import { prisma } from "@prova/db";
import { bidTotalOf } from "@/lib/estimating/recap-state";

/**
 * What the slim header on a C Stream Bid estimate shows: the job's name, the
 * GC it is for, where it stands, and the bid total.
 *
 * NOT `loadJobSummary` (lib/jobs/job-summary.ts), which is the CRM job header's
 * loader: it reads crew, invoices, retainage and warranty to draw a bid-to-
 * warranty lifecycle, none of which exists on an estimate and all of which is
 * what Bid is built not to show. The one figure the two share is the total, and
 * it comes from the SAME `bidTotalOf` (bug C, 2026-10-19: the header's BID and
 * the recap's Bid total were two sums with nothing tying them together).
 *
 * Returns null for a job that is not this company's, so the layout 404s.
 */
export type BidEstimateHeader = {
  id: string;
  name: string;
  gcName: string;
  status: string;
  lineCount: number;
  bidTotal: number;
};

export async function loadBidEstimateHeader(companyId: string, jobId: string): Promise<BidEstimateHeader | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      companyId: true,
      name: true,
      status: true,
      contact: { select: { name: true } },
      lineItems: { where: { isDeleted: false }, select: { quantity: true, unitPrice: true } },
    },
  });
  if (!job || job.companyId !== companyId) return null;
  return {
    id: job.id,
    name: job.name,
    gcName: job.contact.name,
    status: job.status,
    lineCount: job.lineItems.length,
    bidTotal: bidTotalOf(job.lineItems),
  };
}
