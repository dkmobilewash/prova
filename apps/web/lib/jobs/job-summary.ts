import { prisma } from "@prova/db";
import { calculateRetainageSummary } from "@/lib/retainage";

/**
 * The few figures and facts that drive a decision on this job — what the
 * founder asked to see "without having to scroll." Deliberately lean: a
 * full WIP figure (actual cost to date, % complete) needs cost entries,
 * time entries and every craft's fringe schedule, which is real work best
 * left to the Estimate tab that already needs it. This header sticks to
 * numbers cheap enough to compute on every route: a line item's quantity
 * and price, an invoice's amount, a retainage release's amount, a crew
 * assignment's existence.
 *
 * Contract value and dollars billed intentionally use the SAME source
 * arithmetic as the monolith did (`quantity * unitPrice` over
 * non-deleted line items; `sum(invoice.amount)`), not a re-derivation —
 * see lib/wip.ts and the Estimate/Billing routes for the fuller figures
 * that share this same arithmetic.
 */
export type JobSummary = {
  id: string;
  name: string;
  status: string;
  contactName: string;
  startDate: Date | null;
  endDate: Date | null;
  crewSize: number;
  contractValue: number;
  billedToDate: number;
  retainageBalance: number;
};

export async function loadJobSummary(companyId: string, jobId: string): Promise<JobSummary | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      companyId: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      substantialCompletionDate: true,
      contact: { select: { name: true } },
      lineItems: {
        where: { isDeleted: false },
        select: { quantity: true, unitPrice: true },
      },
      invoices: { select: { amount: true, retainageWithheld: true } },
      retainageReleases: { select: { amount: true } },
      assignments: { select: { id: true } },
    },
  });
  if (!job || job.companyId !== companyId) return null;

  const contractValue = job.lineItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice ?? 0),
    0,
  );
  const billedToDate = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  const retainageSummary = calculateRetainageSummary({
    invoiceRetainageWithheld: job.invoices.map((invoice) =>
      invoice.retainageWithheld != null ? Number(invoice.retainageWithheld) : null,
    ),
    releaseAmounts: job.retainageReleases.map((release) => Number(release.amount)),
    substantialCompletionDate: job.substantialCompletionDate,
  });

  return {
    id: job.id,
    name: job.name,
    status: job.status,
    contactName: job.contact.name,
    startDate: job.startDate,
    endDate: job.endDate,
    crewSize: job.assignments.length,
    contractValue,
    billedToDate,
    retainageBalance: retainageSummary.balance,
  };
}
