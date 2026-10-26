/**
 * WHERE THE BID LOG'S PER-ROW LINKS GO, decided once per product.
 *
 * `components/BidLog.tsx` is the CRM's `/bids` page and C Stream Bid's
 * `/bid/bids` page: one component, two products. `lib/bid/surfaceHrefs.ts`
 * answers "where do the links for THIS JOB go"; the log also links per BID and
 * per GC, which are not jobs, so they are answered here.
 *
 * A value is `null` where the product has no such screen, and the log then
 * draws the words as plain text rather than a link to somewhere that does not
 * exist (Bid has no GC page, no per-bid research page and no regret letter —
 * yet — and must not point at the CRM's).
 *
 * THE CRM HALF IS TODAY'S HREFS, byte for byte: each is the literal the page
 * wrote before this file existed, and `bidLogHrefs.test.ts` pins them. Lives in
 * `lib/`, which the link census cannot read, so `bidLinkCensus.test.ts` CALLS
 * `bidLogHrefs("bid")` and classifies every value it returns.
 */
import type { Surface } from "./surfaceHrefs";

export type BidLogHrefs = {
  /** The bid's own page (research, estimate check, addenda, decision). */
  bidPage: (bidInvitationId: string) => string | null;
  /** The GC who invited you. */
  contact: (contactId: string) => string | null;
  /** The decline letter of a declined bid. */
  regret: (bidInvitationId: string) => string | null;
};

export function bidLogHrefs(surface: Surface): BidLogHrefs {
  if (surface === "bid") {
    return { bidPage: () => null, contact: () => null, regret: () => null };
  }
  return {
    bidPage: (id) => `/ai/bids/${id}`,
    contact: (id) => `/contacts/${id}`,
    regret: (id) => `/bids/${id}/regret`,
  };
}
