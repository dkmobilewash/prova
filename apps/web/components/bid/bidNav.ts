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
  { href: "/bid/home", label: "Home" },
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

/**
 * EVERY SIGNED-IN BID ROUTE AND THE CRM SCREEN IT IS THE TWIN OF — the access
 * decision for each, written down.
 *
 * `lib/permissions.test.ts` enforces "every page has a recorded access decision"
 * for `app/(app)` only; Bid's pages are outside that group, so without this table
 * a new Bid page would be a door nobody decided on. `bidRouteCapability.test.ts`
 * walks `app/bid` and fails a page missing here, and for every row proves:
 *
 *   - Bid never admits anyone the twin refuses: for every job function (and
 *     the owner), holding BID_CAPABILITY implies holding `twinCapability`;
 *   - the page really enforces: it calls `requireCapability` itself, or renders
 *     its CRM twin, whose own page source is read for the same capability.
 *
 * `twinCapability` is what the CRM twin demands, NOT what Bid demands (Bid's
 * whole surface demands BID_CAPABILITY — the layout and every page). Rows whose
 * twin is open to any member (the job list, `/jobs/new`) record `null`: Bid is
 * deliberately stricter there, because Bid IS estimating.
 *
 * `/bid/settings` is the one row with a footnote. Its CRM twin is `/settings`
 * (MANAGE_COMPLIANCE) for the markup and opening-deduction forms and
 * `/proposals` (MANAGE_ESTIMATING) for the clause library. The page asks for the
 * second; the forms from the first keep asserting MANAGE_COMPLIANCE in their own
 * actions (`saveCompanyBidDefaults`, `saveOpeningDeduction`), exactly as on the
 * CRM's settings page, and the page says so to a reader who lacks it.
 */
export type BidRoute = {
  route: string;
  /** The CRM route this is the twin of, for the reader. */
  twin: string;
  /** What that twin demands, or null if it is open to any member. */
  twinCapability: Capability | null;
};

export const BID_ROUTES: readonly BidRoute[] = [
  // New in Bid, no CRM twin (`twin` names the nearest: the CRM dashboard). The
  // page enforces BID_CAPABILITY itself; the CRM dashboard is open to any member,
  // so Bid is deliberately stricter here, like `/bid/estimates`.
  { route: "/bid/home", twin: "/dashboard", twinCapability: null },
  { route: "/bid/bids", twin: "/bids", twinCapability: "MANAGE_ESTIMATING" },
  { route: "/bid/bids/[id]", twin: "/ai/bids/[id]", twinCapability: "MANAGE_ESTIMATING" },
  { route: "/bid/bids/[id]/regret", twin: "/bids/[id]/regret", twinCapability: "MANAGE_ESTIMATING" },
  { route: "/bid/estimates", twin: "/jobs?status=ESTIMATE", twinCapability: null },
  { route: "/bid/estimates/new", twin: "/jobs/new", twinCapability: null },
  { route: "/bid/estimates/[id]", twin: "/jobs/[id]", twinCapability: null },
  { route: "/bid/estimates/[id]/takeoff", twin: "/jobs/[id]/takeoff", twinCapability: "VIEW_JOB_COSTS" },
  { route: "/bid/estimates/[id]/takeoff/legend", twin: "/jobs/[id]/takeoff/legend", twinCapability: "VIEW_JOB_COSTS" },
  { route: "/bid/estimates/[id]/estimate", twin: "/jobs/[id]/estimate", twinCapability: "VIEW_JOB_COSTS" },
  { route: "/bid/estimates/[id]/recap", twin: "/jobs/[id]/estimate", twinCapability: "VIEW_JOB_COSTS" },
  { route: "/bid/estimates/[id]/proposal", twin: "/jobs/[id]/proposal", twinCapability: "MANAGE_ESTIMATING" },
  { route: "/bid/workspace/[id]", twin: "/takeoff/[id]", twinCapability: "VIEW_JOB_COSTS" },
  { route: "/bid/wall-types", twin: "/wall-types", twinCapability: "MANAGE_ESTIMATING" },
  { route: "/bid/price-book", twin: "/catalog", twinCapability: "MANAGE_ESTIMATING" },
  { route: "/bid/settings", twin: "/proposals", twinCapability: "MANAGE_ESTIMATING" },
];

/** Pages under `app/bid` that need no session at all (see `isBidSignedInPath`). */
export const BID_PUBLIC_ROUTES: readonly string[] = ["/bid", "/bid/wall-takeoff"];
