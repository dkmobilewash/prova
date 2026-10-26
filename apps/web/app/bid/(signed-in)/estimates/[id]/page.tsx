import { redirect } from "next/navigation";

/**
 * `/bid/estimates/<id>` has no content of its own: an estimate is its four
 * tabs. It opens on the first link of the chain — the takeoff, where the
 * drawing set goes — which is also where `createJob` lands a new estimate
 * (`lib/bid/jobStartDestination.ts`). The layout above has already checked the
 * capability and that the job is this company's.
 */
export default async function BidEstimateIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/bid/estimates/${id}/takeoff`);
}
