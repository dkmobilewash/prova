import JobProposalPage from "@/app/(app)/jobs/[id]/proposal/page";

export const metadata = { title: "Proposal" };

/**
 * C Stream Bid — the proposal: scope, schedule of values, inclusions and
 * exclusions, the bid package. THE CRM'S OWN PAGE rendered with
 * `surface="bid"` — it already draws its own `PageShell` (and prints flush to
 * the paper), so none is added here. Same capability as its CRM twin
 * (`requireCapability("MANAGE_ESTIMATING")`, which is also Bid's own).
 *
 * What differs by `surface`: the "back to the estimate" and "price it on the
 * estimate" links point at Bid's Estimate tab, the empty clause library points
 * at Bid's settings, the sent-email note drops its link to a message log Bid
 * does not have, and the estimate-check findings are listed without their
 * fix links (those are built in the agents' lib and name CRM screens).
 */
export default function BidProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  // `?mode=` (lump sum / by scope / itemized) rides through, and the page's
  // mode links stay inside Bid (`hrefs.proposal`).
  return <JobProposalPage params={params} searchParams={searchParams} surface="bid" />;
}
