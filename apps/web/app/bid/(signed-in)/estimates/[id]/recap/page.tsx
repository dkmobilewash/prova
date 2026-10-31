import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { loadJobEstimateData } from "@/lib/estimating/estimate-data";
import { EstimateRecap } from "@/components/job/EstimateStage";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Bid recap" };

/**
 * C Stream Bid — the bid recap: markup by cost type, overhead, profit, tax,
 * bond and contingency over the estimate's cost, and what each does to the
 * price. Its own tab because it is step 3 of the chain; in the CRM it is a
 * section of the Estimate tab.
 *
 * THE SAME SECTION (`EstimateRecap`) over THE SAME LOADER as the CRM's, with
 * the checks that read the same cost base beneath it (missing general
 * conditions, quantities measured and never priced, prices that look off).
 * `BidRecapPanel` itself draws no link.
 */
export default async function BidRecapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  const data = await loadJobEstimateData(id, context.company.id);
  if (!data) notFound();

  return (
    <PageShell width="working" className="pt-0">
      <EstimateRecap data={data} canManageEstimating />
    </PageShell>
  );
}
