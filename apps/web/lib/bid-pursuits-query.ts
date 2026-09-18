import { prisma } from "@prova/db";
import {
  comparePursuits,
  isBidDateComingUp,
  isBidDatePassed,
  isGoneQuiet,
  isOpenPursuit,
  daysFromTo,
  type BidPursuitStage,
  type PursuitForDerivation,
} from "@/lib/bid-pursuits";

/**
 * The one read of BidPursuit, shared by /pipeline and the Ask tool so the
 * screen and the answer cannot disagree — two surfaces computing the same
 * list separately is the bug this codebase has shipped twice.
 *
 * Reads BidPursuit and, through the optional link, the BidInvitation it
 * became. NEVER SalesLead, SalesOpportunity or SalesActivity — those are
 * Prova's own CRM, and the handler test proxies the client to prove this
 * file does not reach for them.
 */

export type PursuitRow = PursuitForDerivation & {
  id: string;
  projectName: string;
  owner: string | null;
  architect: string | null;
  expectedGcs: string | null;
  note: string | null;
  open: boolean;
  goneQuiet: boolean;
  bidDateComingUp: boolean;
  bidDatePassed: boolean;
  daysSinceUpdate: number;
  invitation: { id: string; projectName: string; status: string; contactId: string; contactName: string } | null;
};

const iso = (date: Date) => date.toISOString().slice(0, 10);

export async function loadBidPursuits(
  companyId: string,
  today: string,
  stages?: BidPursuitStage[],
): Promise<PursuitRow[]> {
  const rows = await prisma.bidPursuit.findMany({
    where: stages ? { companyId, stage: { in: stages } } : { companyId },
    select: {
      id: true,
      projectName: true,
      owner: true,
      architect: true,
      expectedGcs: true,
      expectedBidDate: true,
      estimatedValue: true,
      stage: true,
      note: true,
      updatedAt: true,
      bidInvitation: {
        select: { id: true, projectName: true, status: true, contactId: true, contact: { select: { name: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return rows
    .map((row): PursuitRow => {
      const base: PursuitForDerivation = {
        stage: row.stage as BidPursuitStage,
        expectedBidDate: row.expectedBidDate ? iso(row.expectedBidDate) : null,
        lastUpdated: iso(row.updatedAt),
        estimatedValue: row.estimatedValue === null ? null : Number(row.estimatedValue),
      };
      return {
        ...base,
        id: row.id,
        projectName: row.projectName,
        owner: row.owner,
        architect: row.architect,
        expectedGcs: row.expectedGcs,
        note: row.note,
        open: isOpenPursuit(base.stage),
        goneQuiet: isGoneQuiet(base, today),
        bidDateComingUp: isBidDateComingUp(base, today),
        bidDatePassed: isBidDatePassed(base, today),
        daysSinceUpdate: Math.max(0, daysFromTo(base.lastUpdated, today)),
        invitation: row.bidInvitation
          ? {
              id: row.bidInvitation.id,
              projectName: row.bidInvitation.projectName,
              status: row.bidInvitation.status,
              contactId: row.bidInvitation.contactId,
              contactName: row.bidInvitation.contact.name,
            }
          : null,
      };
    })
    .sort(comparePursuits);
}

/** Invitations a pursuit could be linked to: this company's, not already
 * claimed by another pursuit. Newest first, because the invite that just
 * arrived is the one somebody is linking. */
export async function loadLinkableInvitations(companyId: string) {
  const invitations = await prisma.bidInvitation.findMany({
    where: { companyId, pursuit: null },
    select: { id: true, projectName: true, dueDate: true, contact: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return invitations.map((inv) => ({
    id: inv.id,
    label: `${inv.projectName} — ${inv.contact.name}${inv.dueDate ? ` · due ${iso(inv.dueDate)}` : ""}`,
  }));
}
