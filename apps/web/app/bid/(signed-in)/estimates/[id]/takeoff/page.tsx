import { PageShell } from "@prova/ui";
import JobTakeoffPage from "@/app/(app)/jobs/[id]/(tabs)/takeoff/page";

/**
 * Same ceiling as the CRM's takeoff tab, and for the same reason: a Server
 * Action posts to the route of the page it was rendered from, so THIS number —
 * not the CRM page's — governs `saveTakeoffCalibration` and the wall detection
 * it starts when the sheet is read from here. Segment config has to be written
 * in the route's own file; it cannot be inherited from the page rendered below.
 * `app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx` carries the measurement that
 * explains 300.
 */
export const maxDuration = 300;

export const metadata = { title: "Takeoff" };

/**
 * C Stream Bid — an estimate's takeoff: upload the drawing set, find the walls,
 * set the scale, measure. THE CRM'S OWN TAB, rendered with `surface="bid"`:
 * the same page, the same query, the same viewer — only its links change
 * (`lib/bid/surfaceHrefs.ts`). The access check is that page's own
 * (`requireCapability("VIEW_JOB_COSTS")`), which everyone Bid admits holds.
 */
export default function BidTakeoffPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PageShell width="working" className="pt-0">
      <JobTakeoffPage params={params} surface="bid" />
    </PageShell>
  );
}
