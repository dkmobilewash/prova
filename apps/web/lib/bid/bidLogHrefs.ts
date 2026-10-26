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
 * exist (Bid has no GC page, and must not point at the CRM's). Bid DOES have
 * the bid's own page (`/bid/bids/<id>`) and the regret letter
 * (`/bid/bids/<id>/regret`): the CRM's own screens, rendered with
 * `surface="bid"`.
 *
 * THE CRM HALF IS TODAY'S HREFS, byte for byte: each is the literal the page
 * wrote before this file existed, and `bidLogHrefs.test.ts` pins them. Lives in
 * `lib/`, which the link census cannot read, so `bidLinkCensus.test.ts` CALLS
 * `bidLogHrefs("bid")` and classifies every value it returns.
 */
import type { Surface } from "./surfaceHrefs";

export type BidLogHrefs = {
  /** The bid log itself — where a bid's page and its letter lead back to. */
  list: string;
  /** The bid's own page (research, estimate check, addenda, decision). */
  bidPage: (bidInvitationId: string) => string | null;
  /** The GC who invited you. */
  contact: (contactId: string) => string | null;
  /** The decline letter of a declined bid. */
  regret: (bidInvitationId: string) => string | null;
};

export function bidLogHrefs(surface: Surface): BidLogHrefs {
  if (surface === "bid") {
    return {
      list: "/bid/bids",
      bidPage: (id) => `/bid/bids/${id}`,
      contact: () => null,
      regret: (id) => `/bid/bids/${id}/regret`,
    };
  }
  return {
    list: "/bids",
    bidPage: (id) => `/ai/bids/${id}`,
    contact: (id) => `/contacts/${id}`,
    regret: (id) => `/bids/${id}/regret`,
  };
}

/**
 * THE BID'S OWN PAGE, per product: its breadcrumb. `BidWorkspace` is the CRM's
 * `/ai/bids/<id>` and Bid's `/bid/bids/<id>`. In the CRM the breadcrumb leads
 * to the AI pages; Bid has no AI hub and no agent-activity page, so it leads
 * back to the log.
 */
export function bidPageCrumbs(surface: Surface): { href: string; label: string }[] {
  if (surface === "bid") return [{ href: "/bid/bids", label: "← Back to your bids" }];
  return [
    { href: "/ai", label: "← AI" },
    { href: "/ai/activity", label: "Agent activity & settings" },
  ];
}

const ID = "[A-Za-z0-9_-]+";

/**
 * A link the AGENTS stored (a finding's `fixHref`, a source chip's `href`, an
 * addendum row's link), as the product should draw it — or `null`, meaning
 * "draw the words, not a link".
 *
 * Those strings are written by `lib/agents/*` as CRM routes and live in rows
 * already in the database, so they cannot be changed at the source. Bid keeps
 * exactly two shapes, each of which has a Bid twin: the bid's own page and an
 * estimate. Everything else (`/contacts/<id>`, `/pipeline`, `/backcharges`,
 * `/jobs/<id>` …) is a CRM screen and becomes `null`. The CRM keeps every link
 * exactly as stored.
 */
export function storedHref(surface: Surface, href: string | null | undefined): string | null {
  if (!href) return null;
  if (surface === "crm") return href;
  const bidPage = href.match(new RegExp(`^/ai/bids/(${ID})$`));
  if (bidPage) return `/bid/bids/${bidPage[1]}`;
  const estimate = href.match(new RegExp(`^/jobs/(${ID})/estimate$`));
  if (estimate) return `/bid/estimates/${estimate[1]}/estimate`;
  return null;
}
