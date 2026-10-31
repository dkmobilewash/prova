import { primeWentElsewhere, priceVersusEstimate, DIDNT_GET_THE_JOB } from "./bid-projects";
import { adjustmentLabel, projectGcPrices, type GcAdjustment } from "./estimating/gc-price";
import { bidTotalOf } from "./estimating/recap-state";

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
    /** What this GC is quoted off the estimate (gc-price.ts). Optional so a
     * caller that has not selected them reads as "no adjustment". */
    priceAdjustAmount?: { toString(): string } | null;
    priceAdjustPercent?: { toString(): string } | null;
    priceAdjustReason?: string | null;
  }[];
};

/** One GC's line in the side-by-side: the estimate, its adjustment, its price. */
export type GcPriceView = {
  invitationId: string;
  contactId: string;
  name: string;
  status: string;
  isThis: boolean;
  /** "-$2,500.00" / "+4.5%", or null with no adjustment. */
  adjustment: string | null;
  reason: string | null;
  /** The formatted price, or null when there is no estimate (or the
   * adjustment no longer makes a valid price - then `problem` says so). */
  price: string | null;
  priceDollars: number | null;
  problem: string | null;
  /** What was actually SENT to this GC (an entered fact), formatted, or null. */
  sent: string | null;
  sentDollars: number | null;
  /** The prime went to a different GC: not a loss. */
  didntGetTheJob: boolean;
};

export type ProjectPanelView = {
  /** This invitation's own adjustment, to prefill the form. */
  thisAdjustment: { kind: "none" | "amount" | "percent"; value: string; reason: string };
  /** Every GC's price off the estimate total, side by side. Empty with no estimate. */
  prices: GcPriceView[];
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
  // The ONE sum for "the bid" (recap-state.ts), not a second copy of it.
  return bidTotalOf(lines);
}

const adjustmentOf = (invitation: ProjectRow["invitations"][number]): GcAdjustment | null => {
  const amount = num(invitation.priceAdjustAmount ?? null);
  const percent = num(invitation.priceAdjustPercent ?? null);
  return amount === null && percent === null ? null : { amount, percent };
};

/**
 * Every GC on a project with the price it is quoted, side by side. The price is
 * computed from the estimate's total and the invitation's own adjustment every
 * time (gc-price.ts) - nothing here is read from a stored total.
 */
export function gcPriceViews(
  project: ProjectRow,
  thisInvitationId: string | null,
  format: (n: number) => string,
): { estimateTotal: number | null; rows: GcPriceView[] } {
  const total = project.estimateJob ? estimateTotal(project.estimateJob.lineItems) : null;
  const priced = new Map(
    projectGcPrices(
      total,
      project.invitations.map((i) => ({ invitationId: i.id, adjustment: adjustmentOf(i) })),
    ).map((row) => [row.invitationId, row]),
  );
  return {
    estimateTotal: total,
    rows: project.invitations.map((i) => {
      const row = priced.get(i.id);
      const sent = num(i.bidAmount);
      return {
        invitationId: i.id,
        contactId: i.contactId,
        name: i.contact.name,
        status: i.status,
        isThis: i.id === thisInvitationId,
        adjustment: adjustmentLabel(adjustmentOf(i), format),
        reason: i.priceAdjustReason ?? null,
        price: row?.ok ? format(row.price.priceCents / 100) : null,
        priceDollars: row?.ok ? row.price.priceCents / 100 : null,
        problem: row && !row.ok ? row.error : null,
        sent: sent === null ? null : format(sent),
        sentDollars: sent,
        didntGetTheJob: primeWentElsewhere(project, i.contactId),
      };
    }),
  };
}

const iso = (value: Date | null): string => (value === null ? "" : value.toISOString().slice(0, 10));

export function projectPanelView(
  project: ProjectRow,
  thisInvitation: { id: string; contactId: string; bidAmount: { toString(): string } | null; contact: { name: string } },
  format: (n: number) => string,
): ProjectPanelView {
  const total = project.estimateJob ? estimateTotal(project.estimateJob.lineItems) : null;
  const mine = project.invitations.find((i) => i.id === thisInvitation.id);
  const myAdjustment = mine ? adjustmentOf(mine) : null;
  const awardedName = project.primeAwardedContact?.name ?? project.primeAwardedName?.trim() ?? "";
  return {
    thisAdjustment: {
      kind: myAdjustment?.amount != null ? "amount" : myAdjustment?.percent != null ? "percent" : "none",
      value: String(myAdjustment?.amount ?? myAdjustment?.percent ?? ""),
      reason: mine?.priceAdjustReason ?? "",
    },
    prices: gcPriceViews(project, thisInvitation.id, format).rows,
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
