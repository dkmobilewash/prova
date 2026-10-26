import { PageShell } from "@prova/ui";
import WallLegendReviewPage from "@/app/(app)/jobs/[id]/(tabs)/takeoff/legend/page";

export const metadata = { title: "Wall legend" };

/**
 * C Stream Bid — the wall types read off the drawing's legend, for review. THE
 * CRM'S OWN PAGE rendered with `surface="bid"`; only its back link changes.
 */
export default function BidWallLegendPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PageShell width="working" className="pt-0">
      <WallLegendReviewPage params={params} surface="bid" />
    </PageShell>
  );
}
