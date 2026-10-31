import { BID_PREFIX, isBidPath } from "@/lib/bid/surface";

/**
 * The four screens of one C Stream Bid estimate, in the order of the chain:
 * measure the drawing, price the lines, set the markup, print the proposal.
 *
 * NOT the CRM's `components/job/jobTabs.ts` / `jobStages.ts`, which carry
 * crew, compliance, billing, retainage, punch lists and closeout — everything
 * after the award, and every one of them a link Bid must not draw. Plain
 * template literals rather than `surfaceHrefs("bid", …)` so `bidLinkCensus`
 * READS each target instead of having to trust a function in `lib/`.
 */
export type BidEstimateTab = { key: "takeoff" | "estimate" | "recap" | "proposal"; label: string; href: string };

export function bidEstimateTabs(jobId: string): BidEstimateTab[] {
  return [
    { key: "takeoff", label: "Takeoff", href: `/bid/estimates/${jobId}/takeoff` },
    { key: "estimate", label: "Estimate", href: `/bid/estimates/${jobId}/estimate` },
    { key: "recap", label: "Bid recap", href: `/bid/estimates/${jobId}/recap` },
    { key: "proposal", label: "Proposal", href: `/bid/estimates/${jobId}/proposal` },
  ];
}

/**
 * Which tab the current path is on. On bid.cstream.ai the browser may show
 * `/estimates/<id>/recap` (typed, rewritten by middleware) or the
 * `/bid/estimates/…` form (followed from a link), so both are normalised to
 * the unprefixed form first — the same move `activeBidHref` makes for the
 * top-level nav.
 */
export function activeBidEstimateTab(pathname: string, jobId: string): BidEstimateTab["key"] | null {
  const strip = (p: string) => (isBidPath(p) ? p.slice(BID_PREFIX.length) || "/" : p);
  const here = strip(pathname);
  for (const tab of bidEstimateTabs(jobId)) {
    const base = strip(tab.href);
    if (here === base || here.startsWith(base + "/")) return tab.key;
  }
  return null;
}
