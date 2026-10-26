import { BID_PREFIX, isBidPath } from "@/lib/bid/surface";
import type { Capability } from "@/lib/permissions";

/**
 * C STREAM BID'S OWN NAV — and the only one. The CRM's `components/navItems.tsx`
 * must never carry a `/bid` entry (`bidNavCensus.test.ts`), and nothing here
 * may point at a CRM route (`bidLinkCensus.test.ts`). The two products share
 * a codebase and an account, never a door.
 *
 * The first three are the chain the product sells — bids, estimates (takeoff
 * and recap live on an estimate), wall types. The last two are what that chain
 * READS and cannot work without, traced from the code rather than guessed:
 *
 *   Price book — `LineItemCatalogEntry`. A wall type's parts price from it
 *     (`lib/estimating/wall-schedule.ts`, `unitPrice: entry?.defaultUnitPrice`),
 *     and a wall line with no price-book price comes in COST-ONLY — the
 *     "$0 bid" seam. Without it the chain cannot produce a price.
 *   Settings — the rates the recap and the takeoff read: `CompanyBidDefaults`
 *     (markup by cost type, overhead, profit, tax, bond, contingency, waste —
 *     `components/BidDefaultsForm.tsx`), the opening-deduction habit
 *     (`components/OpeningDeductionForm.tsx`), the proposal clause library
 *     (`ProposalClause`, `components/ProposalClauses.tsx`), and the labour
 *     crafts a wall part's production rate is costed against
 *     (`CraftClassification`).
 */

/** The one capability the whole Bid surface asks for. Bid IS estimating: the
 * CRM gates every screen Bid is made of — `/bids`, `/wall-types`, `/catalog`,
 * `/proposals` — on this same capability (`ROUTE_CAPABILITY` in
 * lib/permissions.ts), so a person who can reach them there can reach them
 * here, and nobody else. */
export const BID_CAPABILITY: Capability = "MANAGE_ESTIMATING";

export type BidNavItem = { href: string; label: string };

export const BID_NAV: readonly BidNavItem[] = [
  // Plain literals rather than built from BID_PREFIX, so the link census can
  // READ every target instead of having to trust a template.
  { href: "/bid/bids", label: "Bids" },
  { href: "/bid/estimates", label: "Estimates" },
  { href: "/bid/wall-types", label: "Wall types" },
  { href: "/bid/price-book", label: "Price book" },
  { href: "/bid/settings", label: "Settings" },
];

/**
 * Which nav entry the current path belongs to. On bid.cstream.ai the browser
 * may show either `/estimates/abc` (typed, rewritten by middleware) or
 * `/bid/estimates/abc` (followed from a link), so both are normalised to the
 * unprefixed form before comparing.
 */
export function activeBidHref(pathname: string): string | null {
  const strip = (p: string) => (isBidPath(p) ? p.slice(BID_PREFIX.length) || "/" : p);
  const here = strip(pathname);
  for (const item of BID_NAV) {
    const base = strip(item.href);
    if (here === base || here.startsWith(base + "/")) return item.href;
  }
  return null;
}
