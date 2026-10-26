import { prisma, type Prisma } from "@prova/db";

/**
 * The reads /bids needs for bid projects, kept out of the 760-line page.
 *
 * `bidProjectInclude` is what each invitation row nests so the panel can say
 * who else is on the job, what the estimate is and who won the prime;
 * `lib/bid-project-view.ts` turns it into the panel's data.
 */
export const bidProjectInclude = {
  primeAwardedContact: { select: { name: true } },
  estimateJob: {
    select: {
      id: true,
      name: true,
      // Quantity and sale price only: the total the "sent vs estimate"
      // sentence compares against. A cost-only line has no price and adds 0.
      // LIVE lines only - the same rows the proposal and the job header add up,
      // so a deleted line cannot make this total disagree with them.
      lineItems: { where: { isDeleted: false }, select: { quantity: true, unitPrice: true } },
    },
  },
  invitations: {
    select: {
      id: true,
      contactId: true,
      status: true,
      bidAmount: true,
      priceAdjustAmount: true,
      priceAdjustPercent: true,
      priceAdjustReason: true,
      contact: { select: { name: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.BidProjectInclude;

/** Every project the "same job as…" picker can offer, newest first, with the
 * GCs already on it so two same-named projects are told apart. */
export async function loadProjectChoices(companyId: string) {
  const projects = await prisma.bidProject.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      name: true,
      bidDueDate: true,
      invitations: { select: { contact: { select: { name: true } } } },
    },
  });
  return projects.map((project) => ({
    id: project.id,
    label: `${project.name} — ${project.invitations.map((i) => i.contact.name).join(", ") || "no GC"}${
      project.bidDueDate ? ` · due ${project.bidDueDate.toISOString().slice(0, 10)}` : ""
    }`,
  }));
}

/**
 * The projects to draw outcomes for in C Stream Bid's bids list: every project
 * that has at least one invitation, soonest bid date first (undated last), then
 * newest. Read-only; the same include as /bids so `BidProjectOutcomes` renders
 * both from one shape.
 */
export async function loadProjectOutcomes(companyId: string, take = 25) {
  return prisma.bidProject.findMany({
    where: { companyId, invitations: { some: {} } },
    orderBy: [{ bidDueDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take,
    include: bidProjectInclude,
  });
}
