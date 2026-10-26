import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { loadJobEstimateData } from "@/lib/estimating/estimate-data";
import { EstimateLineItems, EstimateVersions, EstimateWallSchedule } from "@/components/job/EstimateStage";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Estimate" };

/**
 * C Stream Bid — the estimate: the priced lines, the wall schedule that
 * generates some of them, and saved versions.
 *
 * THE CRM'S OWN SECTIONS (`components/job/EstimateStage.tsx`, moved out of the
 * Estimate tab unchanged) over THE CRM'S OWN LOADER (`loadJobEstimateData`), so
 * a line priced here is the line the CRM shows and the recap marks up. What is
 * deliberately not here is everything past the award: the "Ready to lock this
 * in?" contract gate, job costing and WIP, change orders, DocuSign. The bid
 * recap is its own tab (`../recap`).
 *
 * The CRM tab soft-gates on VIEW_JOB_COSTS; Bid's gate is MANAGE_ESTIMATING,
 * and `bidRouteCapability.test.ts` proves every function that holds the second
 * holds the first, so this is never looser than its twin. The actions behind
 * every form assert their own capability regardless.
 */
export default async function BidEstimateTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  const data = await loadJobEstimateData(id, context.company.id);
  if (!data) notFound();

  return (
    <PageShell width="working" className="pt-0">
      <EstimateLineItems data={data} surface="bid" />
      <EstimateWallSchedule data={data} surface="bid" />
      <EstimateVersions data={data} />
    </PageShell>
  );
}
