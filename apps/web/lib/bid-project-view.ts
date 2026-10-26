import { primeWentElsewhere, priceVersusEstimate, DIDNT_GET_THE_JOB } from "./bid-projects";

/**
 * What /bids shows about the project an invitation sits on, as plain data.
 *
 * Built from rows the page has already read, never stored: "didn't get the
 * job" is the project's entered prime award against this invitation's GC,
 * the GC count is a count, the estimate total is the sum of its lines.
 * `components/BidProjectPanel.tsx` only renders what this returns.
 */

export type ProjectRow = {
  id: string;
  name: string;
  siteAddress: string | null;
  siteCity: string | null;
  owner: string | null;
  architect: string | null;
  bidDueDate: Date | null;
  primeAwardedContactId: string | null;
  primeAwardedName: string | null;
  primeAwardedOn: Date | null;
  primeAwardedContact: { name: string } | null;
  estimateJob: {
    id: string;
    name: string;
    lineItems: { quantity: { toString(): string }; unitPrice: { toString(): string } | null }[];
  } | null;
  invitations: {
    id: string;
    contactId: string;
    status: string;
    bidAmount: { toString(): string } | null;
    contact: { name: string };
  }[];
};

export type ProjectPanelView = {
  projectId: string;
  projectName: string;
  siteAddress: string;
  siteCity: string;
  owner: string;
  architect: string;
  bidDueDate: string;
  gcs: { invitationId: string; contactId: string; name: string; status: string; isThis: boolean }[];
  estimate: { jobId: string; name: string } | null;
  /** Σ quantity × unit price on the estimate, or null with no estimate. */
  estimateTotal: number | null;
  /** The sentence for "sent to this GC" vs "the estimate says", or null. */
  priceSentence: string | null;
  /** The prime contract went to another GC: this invitation is not a loss. */
  didntGetTheJob: boolean;
  didntGetTheJobLabel: string;
  /** Who won the prime and when (entered), for the project's own line. */
  primeAwarded: { contactId: string | null; name: string; on: string | null } | null;
  /** The GC the estimate would start as, for the button's note. */
  firstGcName: string | null;
};

const num = (value: { toString(): string } | null): number | null => (value === null ? null : Number(value.toString()));

/** Σ quantity × unit price. A line with no sale price (a cost-only line) adds
 * nothing, as it does in the contract value. */
export function estimateTotal(lines: { quantity: { toString(): string }; unitPrice: { toString(): string } | null }[]): number {
  return lines.reduce((sum, line) => sum + Number(line.quantity.toString()) * (num(line.unitPrice) ?? 0), 0);
}

const iso = (value: Date | null): string => (value === null ? "" : value.toISOString().slice(0, 10));

export function projectPanelView(
  project: ProjectRow,
  thisInvitation: { id: string; contactId: string; bidAmount: { toString(): string } | null; contact: { name: string } },
  format: (n: number) => string,
): ProjectPanelView {
  const total = project.estimateJob ? estimateTotal(project.estimateJob.lineItems) : null;
  const awardedName = project.primeAwardedContact?.name ?? project.primeAwardedName?.trim() ?? "";
  return {
    projectId: project.id,
    projectName: project.name,
    siteAddress: project.siteAddress ?? "",
    siteCity: project.siteCity ?? "",
    owner: project.owner ?? "",
    architect: project.architect ?? "",
    bidDueDate: iso(project.bidDueDate),
    gcs: project.invitations.map((i) => ({
      invitationId: i.id,
      contactId: i.contactId,
      name: i.contact.name,
      status: i.status,
      isThis: i.id === thisInvitation.id,
    })),
    estimate: project.estimateJob ? { jobId: project.estimateJob.id, name: project.estimateJob.name } : null,
    estimateTotal: total,
    priceSentence: priceVersusEstimate(num(thisInvitation.bidAmount), total, thisInvitation.contact.name, format),
    didntGetTheJob: primeWentElsewhere(project, thisInvitation.contactId),
    didntGetTheJobLabel: DIDNT_GET_THE_JOB,
    primeAwarded:
      awardedName === ""
        ? null
        : { contactId: project.primeAwardedContactId, name: awardedName, on: project.primeAwardedOn ? iso(project.primeAwardedOn) : null },
    firstGcName: project.invitations[0]?.contact.name ?? null,
  };
}
