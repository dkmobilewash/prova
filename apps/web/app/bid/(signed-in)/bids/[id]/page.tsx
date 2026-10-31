import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";
import { BidWorkspace, bidTabFrom } from "@/components/ai-bid/BidWorkspace";
import { loadBidWorkspace } from "@/lib/agents/bidWorkspace";
import { dismissFinding, markFindingWrong } from "@/lib/actions/agentFindings";
import { bidPageData } from "@/lib/bid/bidPageData";
import { viewerTimeZone } from "@/lib/viewerToday";

export const metadata = { title: "Bid" };

/**
 * C Stream Bid — one bid: what research found, what the estimate check
 * flagged, the addenda, and the advice, with the decision left to the person.
 * THE CRM'S OWN WORKSPACE (`components/ai-bid/BidWorkspace.tsx`, the page
 * behind `/ai/bids/<id>`) rendered with `surface="bid"`; `?tab=` picks the step.
 *
 * Same capability as the CRM page (`MANAGE_ESTIMATING`, which is Bid's own
 * gate) and the same company scoping: `loadBidWorkspace` looks the bid up by id
 * AND this company, so another company's bid is a 404.
 *
 * What differs from the CRM page:
 *   - The breadcrumb leads back to the bid log, not to the AI pages.
 *   - NO ASK PANEL, and so no "Your earlier questions": Bid has no Ask. The
 *     Decision step is one column.
 *   - "Open the bid →" and "Log one on the bid →" (both go to the GC's contact
 *     page) are not drawn; Bid has no GC page.
 *   - Every link the agents stored goes through `bidPageData`: a link to this
 *     bid or to an estimate becomes its Bid twin, anything else (a GC, the
 *     pipeline, backcharges, a past job) is drawn as words.
 */
export default async function BidPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  const [{ id }, { tab: rawTab }] = await Promise.all([params, searchParams]);

  const [data, zone] = await Promise.all([loadBidWorkspace(id, context.company.id), viewerTimeZone()]);
  if (!data) notFound();

  return (
    <PageShell width="working">
      <BidWorkspace
        surface="bid"
        data={bidPageData(data)}
        tab={bidTabFrom(rawTab)}
        zone={zone}
        findingActions={{ dismiss: dismissFinding, wrong: markFindingWrong }}
      />
    </PageShell>
  );
}
