import { requireCapability } from "@/lib/authz";
import { BidLog } from "@/components/BidLog";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Bids" };

/**
 * C Stream Bid — the bid log. Step 1 of the chain, and the signed-in home.
 *
 * THE CRM'S OWN BID LOG (`components/BidLog.tsx`) rendered with
 * `surface="bid"`: log a bid (paste an invite, the same-job warning, "Same job
 * as…", "We reached out"), every invitation grouped under its project with its
 * status, price and outcome, the editable bid details (due time, walk, RFI
 * cutoff), the Project panel (merge / split / start the estimate / prime
 * award), each GC's price and its own proposal, and the lines, addenda, quotes
 * and job link behind each row. Not a copy: the same component, so a fix to the
 * log is a fix to both.
 *
 * What differs by `surface`: "Start the estimate" and every estimate link open
 * Bid's estimate, each GC's Proposal link opens Bid's proposal for that GC, a
 * missing GC is added in Bid's settings, a bid's name opens its page inside Bid
 * (`/bid/bids/<id>`) and a declined bid's regret link opens Bid's letter
 * (`/bid/bids/<id>/regret`); the one name that would open a CRM-only screen, the
 * GC's contact page, is plain text. The heading and the first-run empty state are this file's, since
 * the CRM's carry links out of Bid.
 */
export default async function BidLogPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string; status?: string; new?: string; view?: string; all?: string }>;
}) {
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;

  return (
    <BidLog
      surface="bid"
      searchParams={searchParams}
      company={context.company}
      header={
        <>
          <h1 className="mb-1 font-headline text-3xl font-semibold text-ink">Bids</h1>
          <p className="mb-6 text-sm text-ink-body">
            Every job you have been invited to price, soonest due first.
          </p>
        </>
      }
      emptyState={
        <div className="rounded-xl border border-line-card bg-surface p-6" data-bid="bids-empty">
          <p className="font-medium text-ink">No bids logged yet</p>
          <p className="mt-1 text-sm text-ink-body">
            Everything you have been asked to price, who asked, and how it went &mdash; won, lost or still out. Press
            &ldquo;+ Log a bid&rdquo; above when a GC invites you (you can paste their email and C Stream fills the
            form in). Once a few are in, filtering by type of work shows what similar jobs went for last time.
          </p>
        </div>
      }
    />
  );
}
