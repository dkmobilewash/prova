// Two follow-ups a pay application owes, as pure functions the billing tab
// composes from rows it already reads (lien-waiver-query.ts, the pay
// application assembly). Same division as lib/lien-waiver.ts, and under the
// same rule from the lien-waivers schema: THIS APP NEVER SAYS A WAIVER IS
// SAFE TO SIGN and never writes statutory wording. Nothing here reassures;
// an empty `missing` list is "nothing we can see", not "you are covered".
//
//   1. THE OFFER. A progress application is paid against a CONDITIONAL
//      PROGRESS waiver, so once one is created the matching waiver's two
//      figures are already known: the amount is what the GC is being asked
//      to pay (line 8 of the G702, current payment due, net of retainage)
//      and the through date is the application's PERIOD TO. Both are
//      offered pre-filled; the EXCEPTIONS are never filled — a number the
//      app writes into a waiver is a decision the app made, which
//      lib/lien-waiver.ts rules out.
//   2. THE LOWER-TIER CHECK. Before an application goes to the GC, the
//      waivers the sub owes UPWARD are usually conditioned on the waivers
//      the sub has collected DOWNWARD for the previous period — from its
//      suppliers and lower-tier subs. Those arrive as inbound compliance
//      documents (ComplianceDocumentType.LIEN_WAIVER, partyName, periodEnd).
//      This joins the outbound side (the previous application's period) to
//      the inbound side and names who has not sent one.

import { money } from "@/lib/money";

export interface PayAppForWaiverOffer {
  invoiceId: string;
  number: number;
  /** G702 line 8 — what the GC is asked to pay on this application. */
  currentPaymentDue: number;
  periodTo: Date | null;
  /** True when any lien waiver row already points at this invoice. */
  hasWaiver: boolean;
}

export interface WaiverOffer {
  invoiceId: string;
  invoiceNumber: number;
  amount: number;
  /** `YYYY-MM-DD` for the date input, or null when the application predates
   * the period-to column — then the person types it. */
  throughDate: string | null;
  /** The sentence the button carries. */
  label: string;
}

/** The matching conditional progress waiver to offer, or null when one is
 * already linked or there is nothing to be paid (a credit, a zero). */
export function waiverOfferFor(payApp: PayAppForWaiverOffer): WaiverOffer | null {
  if (payApp.hasWaiver) return null;
  if (!(payApp.currentPaymentDue > 0)) return null;
  const throughDate = payApp.periodTo ? payApp.periodTo.toISOString().slice(0, 10) : null;
  return {
    invoiceId: payApp.invoiceId,
    invoiceNumber: payApp.number,
    amount: Math.round(payApp.currentPaymentDue * 100) / 100,
    throughDate,
    label: `Issue the conditional progress waiver for application #${payApp.number}: ${money(payApp.currentPaymentDue)}${
      throughDate ? ` through ${throughDate}` : ""
    }`,
  };
}

export interface InboundWaiver {
  partyName: string;
  /** The date the inbound waiver runs through. Null means the document
   * carries no period, which cannot prove any period and so covers none. */
  periodEnd: Date | null;
  status: "PENDING" | "RECEIVED";
}

export interface LowerTierCheckInput {
  /** The PREVIOUS application's period-to (or its issue day when it has
   * none). Null when this is the first application — nothing to check. */
  previousPeriodTo: Date | null;
  /** Who the sub buys from on this job: vendors with a material order, and
   * anyone who has ever sent a lien waiver on it. */
  parties: readonly string[];
  inbound: readonly InboundWaiver[];
}

export interface LowerTierCheck {
  previousPeriodTo: Date | null;
  /** Parties with no RECEIVED waiver running through the previous period. */
  missing: string[];
  covered: string[];
  /** The sentence for the screen, or null when there is nothing to say —
   * which includes "no previous period" and "no lower tier on this job".
   * It never says anyone is covered. */
  warning: string | null;
}

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function missingLowerTierWaivers(input: LowerTierCheckInput): LowerTierCheck {
  const through = input.previousPeriodTo;
  const parties = [...new Map(input.parties.map((p) => [key(p), p.trim()])).values()].filter((p) => p.length > 0);
  if (!through || parties.length === 0) {
    return { previousPeriodTo: through, missing: [], covered: [], warning: null };
  }
  const coveredKeys = new Set(
    input.inbound
      .filter((w) => w.status === "RECEIVED" && w.periodEnd !== null && w.periodEnd.getTime() >= through.getTime())
      .map((w) => key(w.partyName)),
  );
  const covered = parties.filter((p) => coveredKeys.has(key(p)));
  const missing = parties.filter((p) => !coveredKeys.has(key(p)));
  const day = through.toISOString().slice(0, 10);
  const warning =
    missing.length === 0
      ? null
      : `Before this goes to the GC: no lower-tier lien waiver received through ${day} from ${missing.join(", ")}. ` +
        `Collect them on the Compliance page, or send knowing the GC may hold payment for them.`;
  return { previousPeriodTo: through, missing, covered, warning };
}
