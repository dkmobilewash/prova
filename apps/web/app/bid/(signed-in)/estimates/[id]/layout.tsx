import { notFound } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { money } from "@/lib/money";
import { loadBidEstimateHeader } from "@/lib/bid/estimateHeader";
import { BidEstimateTabs } from "@/components/bid/BidEstimateTabs";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

/**
 * One C Stream Bid estimate: a SLIM header (name, GC, bid total) and the four
 * tabs of the chain — Takeoff · Estimate · Bid recap · Proposal.
 *
 * NOT the CRM's `jobs/[id]/(tabs)/layout.tsx`, and not its parts: that layout
 * is `JobSummaryHeader` (crew, billed, retainage, "Mark contracted"),
 * `JobStageNav` (billing, retainage, closeout…) and `JobSectionNav`, every one
 * of which is a link Bid must not draw (`bidLinkCensus.test.ts`). This one
 * reads three facts about the job and one total (`bidTotalOf`, the same sum the
 * CRM header and the recap use).
 *
 * THE HEADER AND TABS DO NOT PRINT. The proposal tab is a printable document
 * (the browser's Save as PDF) and is rendered by the same page the CRM prints
 * from; navigation chrome on a GC's copy would be the bug.
 *
 * A job that is no longer an ESTIMATE has been awarded and belongs to the full
 * product. It is not editable here — the lines on a contracted job change by
 * change order — so the tabs are replaced by a sentence saying so, with no
 * link anywhere, rather than rendering an estimate screen that would refuse
 * every save.
 *
 * Per CLAUDE.md the layout is NOT the boundary for the pages beneath it (they
 * render concurrently), so each page below still calls `requireCapability`.
 */
export default async function BidEstimateLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  const header = await loadBidEstimateHeader(context.company.id, id);
  if (!header) notFound();

  return (
    <>
      <PageShell width="working" className="pb-0 print:hidden">
        <p className="mb-1 text-sm">
          <Link href="/bid/estimates" className="inline-flex min-h-11 items-center text-link hover:underline">
            ← All estimates
          </Link>
        </p>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1" data-bid="estimate-header">
          <div className="min-w-0">
            <h1 className="break-words font-headline text-2xl font-semibold text-ink sm:text-3xl">{header.name}</h1>
            <p className="text-sm text-ink-body">For {header.gcName}</p>
          </div>
          <p className="text-sm text-ink-body">
            Bid total <span className="text-lg font-semibold tabular-nums text-ink">{money(header.bidTotal)}</span>
          </p>
        </div>
        {header.status === "ESTIMATE" ? <BidEstimateTabs jobId={id} /> : null}
      </PageShell>
      {header.status === "ESTIMATE" ? (
        children
      ) : (
        <PageShell width="working" className="pt-0">
          <p className="max-w-prose rounded-lg border border-line-card bg-surface p-4 text-sm text-ink-body">
            This job has been awarded, so it is no longer an estimate — its lines change by change order now, not
            here. Nothing was lost; it is the same job in C Stream.
          </p>
        </PageShell>
      )}
    </>
  );
}
