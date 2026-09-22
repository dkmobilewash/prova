import { prisma } from "@prova/db";
import { calculateRetainageSummary } from "@/lib/retainage";

/**
 * The few figures and facts that drive a decision on this job — what the
 * founder asked to see "without having to scroll." Deliberately lean: a
 * full WIP figure (actual cost to date, % complete) needs cost entries,
 * time entries and every craft's fringe schedule, which is real work best
 * left to the Estimate tab that already needs it. This header sticks to
 * numbers cheap enough to compute on every route: a line item's quantity
 * and price, an invoice's amount, a retainage release's amount, who is on
 * the crew.
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
  /** People on this job: see `crewHeadcount`. */
  crewSize: number;
  contractValue: number;
  billedToDate: number;
  retainageBalance: number;
};

/** How many distinct people are on this job's crew: everyone ASSIGNED to
 * it, plus everyone who has LOGGED HOURS on it — a signed-in user or a crew
 * member without a login — each person counted once.
 *
 * WHY BOTH, and it is the bug this replaced. The header counted
 * `JobAssignment` rows only. Assignment is a user-only table (a crew member
 * has no login and cannot be assigned), and nothing requires assigning
 * someone before logging their time — so a job whose foreman had logged
 * 35.3 hours for Luis Ortega this month showed "Crew 0 people" directly
 * above those hours. Counting only who logged time would miss the reverse:
 * somebody assigned on Monday who has not worked yet. The union is the only
 * reading where the number and the Crew & time tab below it agree.
 *
 * Derived on every render, never stored (CLAUDE.md: derived state is never
 * stored). Hours "ever" rather than "this month", because the label says
 * Crew, not "active this month" — a window would make the number drift with
 * the calendar while nothing on the job changed. */
export function crewHeadcount(input: {
  assignedUserIds: string[];
  timeEntryWorkers: { employeeUserId: string | null; crewMemberId: string | null }[];
}): number {
  const people = new Set<string>(input.assignedUserIds.map((id) => `user:${id}`));
  for (const worker of input.timeEntryWorkers) {
    if (worker.employeeUserId) people.add(`user:${worker.employeeUserId}`);
    else if (worker.crewMemberId) people.add(`crew:${worker.crewMemberId}`);
  }
  return people.size;
}

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
      assignments: { select: { userId: true } },
      // One row per distinct worker, not one per entry — a long job has
      // thousands of entries and a handful of people.
      timeEntries: {
        select: { employeeUserId: true, crewMemberId: true },
        distinct: ["employeeUserId", "crewMemberId"],
      },
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
    crewSize: crewHeadcount({
      assignedUserIds: job.assignments.map((assignment) => assignment.userId),
      timeEntryWorkers: job.timeEntries,
    }),
    contractValue,
    billedToDate,
    retainageBalance: retainageSummary.balance,
  };
}
