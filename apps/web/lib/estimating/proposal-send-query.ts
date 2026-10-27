import { prisma } from "@prova/db";
import { emailSetupProblem } from "@prova/integrations";
import { money } from "@/lib/money";
import { formatInstant } from "@/lib/render-date";
import { reachedProvider } from "@/components/messageLabels";
import { groupProposalClauses, PROPOSAL_CLAUSE_HEADINGS } from "@/lib/proposal-clauses";
import { recipientFor, type Recipient } from "@/lib/estimating/bid-submission";
import { bidTotalOf } from "@/lib/estimating/recap-state";
import { gcPrice } from "@/lib/estimating/gc-price";
import {
  bidFormSections,
  proposalPresentation,
  type ProposalLineInput,
  type ProposalMode,
} from "@/lib/estimating/proposal-presentation";
import {
  BID_INVITATION_RELATED_TYPE,
  deploymentSendRefusal,
  proposalCoverNote,
  proposalEmailText,
  proposalSendBlocker,
  proposalSendSubject,
  type SendableInvitationStatus,
} from "@/lib/estimating/proposal-send";

/**
 * EVERYTHING A PROPOSAL SEND NEEDS, read from the rows — once for the composer
 * on the page, and AGAIN by the action at the moment it sends. The page and the
 * action call this one function, so the figure on the screen, the figure the
 * action checks it against and the figure in the email cannot come from two
 * different sums.
 *
 * Scoped like the proposal page's own `?invitation=` lookup: the invitation
 * must be this company's AND priced by this estimate (on the project whose
 * estimate this is, or linked to this job by `wonJobId`). Anything else is
 * "not found", never a proposal addressed to the wrong GC.
 */

export type ProposalSendHistoryRow = {
  id: string;
  at: Date;
  toAddress: string;
  /** Reached the provider (`reachedProvider`): it went, and its record is evidence. */
  reached: boolean;
  detail: string | null;
};

export type ProposalSendView = {
  jobId: string;
  invitationId: string;
  contactId: string;
  status: SendableInvitationStatus;
  bidAmountIsBlank: boolean;
  gcName: string;
  projectName: string;
  companyName: string;
  mode: ProposalMode;
  lineCount: number;
  /** The price this proposal prints for this GC, in whole cents. */
  totalCents: number;
  /** Every address recorded against the GC; the first is the default. Empty when none. */
  recipients: Recipient[];
  /** Why it cannot be sent now, or null. One sentence (`proposalSendBlocker`). */
  blocker: string | null;
  subject: string;
  coverNote: string;
  /** The proposal itself, as the text that goes under the cover note. */
  documentText: string;
  /** This invitation's earlier sends, newest first. */
  history: ProposalSendHistoryRow[];
};

export type ProposalSendLoad = { ok: true; view: ProposalSendView } | { ok: false; problem: string };

export async function loadProposalSend(input: {
  companyId: string;
  companyName: string;
  jobId: string;
  invitationId: string;
  mode: ProposalMode;
  timeZone: string;
  now?: Date;
  env?: Record<string, string | undefined>;
}): Promise<ProposalSendLoad> {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId: input.companyId },
    select: {
      id: true,
      scope: true,
      projectLocation: true,
      lineItems: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          description: true,
          unit: true,
          quantity: true,
          unitPrice: true,
          tradeScope: true,
          wallTypeComponent: { select: { wallType: { select: { code: true, name: true } } } },
        },
      },
      proposalClauses: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { kind: true, text: true },
      },
    },
  });
  if (!job) return { ok: false, problem: "That estimate wasn't found." };

  const invitation = await prisma.bidInvitation.findFirst({
    where: {
      id: input.invitationId,
      companyId: input.companyId,
      OR: [{ bidProject: { estimateJobId: job.id } }, { wonJobId: job.id }],
    },
    include: {
      contact: { include: { people: true } },
      lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!invitation) return { ok: false, problem: "That GC's bid isn't on this estimate any more. Reload the page." };

  const lines: ProposalLineInput[] = job.lineItems.map((item) => ({
    id: item.id,
    description: item.description,
    unit: item.unit,
    quantity: Number(item.quantity),
    unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
    wallType: item.wallTypeComponent?.wallType ?? null,
    tradeScope: item.tradeScope,
  }));

  // THE GC'S PRICE, by the same rule the page prints with (`gc-price.ts`).
  const adjustment = {
    amount: invitation.priceAdjustAmount != null ? Number(invitation.priceAdjustAmount) : null,
    percent: invitation.priceAdjustPercent != null ? Number(invitation.priceAdjustPercent) : null,
  };
  const gc = gcPrice(bidTotalOf(lines), adjustment);
  if (!gc.ok) return { ok: false, problem: `The proposal for ${invitation.contact.name} can't be sent: ${gc.error}` };

  const presentation = proposalPresentation(lines, input.mode, gc.priceCents);
  const totalCents = Math.round(presentation.total * 100);

  const bidForm = bidFormSections(
    invitation.lines.map((bidLine) => ({
      kind: bidLine.kind,
      label: bidLine.label,
      description: bidLine.description,
      amount: bidLine.amount != null ? Number(bidLine.amount) : null,
      unit: bidLine.unit,
      unitPrice: bidLine.unitPrice != null ? Number(bidLine.unitPrice) : null,
    })),
    money,
  );

  const documentText = proposalEmailText(
    {
      title: invitation.projectName,
      companyName: input.companyName,
      addressedTo: invitation.contact.name,
      dateLabel: formatInstant(input.now ?? new Date(), input.timeZone, "numeric"),
      location: job.projectLocation,
      scope: job.scope,
      presentation,
      bidForm,
      clauseGroups: groupProposalClauses(job.proposalClauses).map((group) => ({
        heading: PROPOSAL_CLAUSE_HEADINGS[group.kind],
        texts: group.clauses.map((clause) => clause.text),
      })),
    },
    money,
  );

  const choice = recipientFor({
    contactName: invitation.contact.name,
    contactEmail: invitation.contact.email,
    people: invitation.contact.people.map((person) => ({ name: person.name, email: person.email })),
  });

  const status = invitation.status as SendableInvitationStatus;
  const blocker = proposalSendBlocker({
    deploymentProblem: deploymentSendRefusal(input.env ?? process.env),
    setupProblem: emailSetupProblem(),
    status,
    lineCount: lines.length,
    totalCents,
    recipientProblem: choice.ok ? null : choice.problem,
  });

  const sends = await prisma.outboundMessage.findMany({
    where: { companyId: input.companyId, relatedType: BID_INVITATION_RELATED_TYPE, relatedId: invitation.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      createdAt: true,
      toAddress: true,
      providerMessageId: true,
      events: { orderBy: { occurredAt: "desc" }, select: { type: true, detail: true } },
    },
  });

  return {
    ok: true,
    view: {
      jobId: job.id,
      invitationId: invitation.id,
      contactId: invitation.contactId,
      status,
      bidAmountIsBlank: invitation.bidAmount === null,
      gcName: invitation.contact.name,
      projectName: invitation.projectName,
      companyName: input.companyName,
      mode: input.mode,
      lineCount: lines.length,
      totalCents,
      recipients: choice.ok ? [choice.recipient, ...choice.alternatives] : [],
      blocker,
      subject: proposalSendSubject(invitation.projectName, input.companyName),
      coverNote: proposalCoverNote({
        gcName: invitation.contact.name,
        projectName: invitation.projectName,
        companyName: input.companyName,
      }),
      documentText,
      history: sends.map((send) => ({
        id: send.id,
        at: send.createdAt,
        toAddress: send.toAddress,
        reached: reachedProvider(send.providerMessageId, send.events),
        detail: send.events[0]?.detail ?? null,
      })),
    },
  };
}
