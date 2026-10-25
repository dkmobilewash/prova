import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { formatCalendarDate } from "@/lib/render-date";
import { viewerToday } from "@/lib/viewerToday";
import { daysLeftLabel } from "@/lib/bids-due-soon";
import { loadBidsDueSoon } from "@/lib/bids-due-soon-query";
import { BidComingSoon } from "@/components/bid/BidComingSoon";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Bids" };

/**
 * C Stream Bid — the bid log. Step 1 of the chain, and the signed-in home.
 *
 * WHAT IS REAL TODAY: the "Due soon" list, read by the SAME query the CRM's
 * bid desk uses (`loadBidsDueSoon`) and labelled by the same `daysLeftLabel`.
 * Rows do not link yet — the bid's own page is not ported (below).
 *
 * PORTING BRIEF (wave 2). Source: `app/(app)/bids/page.tsx`. Every href that
 * leaks to a CRM route, found by `lib/bid/navTargets.ts` over its import
 * closure:
 *   - the page itself: `/bids?view=…` (x6, the Due soon / All bids tabs and
 *     "see all" links → `/bid/bids?view=…`); `/ai/bids/${id}` (the row link,
 *     x2 → a Bid bid page); `/contacts/${contactId}` (the GC name → drop, or
 *     a Bid GC page); `/bids/${id}/regret` (the regret letter → port
 *     `app/(app)/bids/[id]/regret/` under `/bid/bids/[id]/regret`); the empty
 *     state's `/contacts` and `/pipeline` actions; `allHref`/`fewerHref`
 *     built from `/bids?…`.
 *   - `components/LogBidForm.tsx:49` links `/contacts` ("add a GC first") —
 *     needs a Bid way to add a GC (a contact create, no CRM page).
 *   - `components/EmptyState.tsx` → `components/EmptyStateButtons.tsx:86`
 *     `router.push("/ask")` (the AskItButton action). EmptyState cannot be
 *     imported into Bid until that push is made optional or Bid gets its own
 *     empty state.
 *   - `components/PageHeader.tsx` (breadcrumb `Home` → `/dashboard`, area
 *     links from `lib/areas.ts`, and it imports `navItems.tsx`) and
 *     `components/NoAccess.tsx` (`/dashboard`) — use `BidNoAccess` and a
 *     Bid heading instead.
 *   - The bid's own page `app/(app)/ai/bids/[id]/page.tsx` →
 *     `components/ai-bid/BidWorkspace.tsx` links `/ai`, `/ai/activity`,
 *     `/contacts/${id}` (x2) and renders agent findings whose `fixHref` is
 *     built in `lib/agents/*` (dynamic, CRM routes); `components/AskPanel.tsx`
 *     links `/ask` and `/intake`. The panels it composes (`BidLines`,
 *     `BidCompliance`, `BidLevelling`, `BidJobLink`, `BidOutcomeForm`) have
 *     no CRM hrefs of their own.
 */
export default async function BidLogPage() {
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  const today = await viewerToday();
  const dueSoon = await loadBidsDueSoon(context.company.id, today);

  return (
    <PageShell width="working">
      <h1 className="mb-1 font-headline text-3xl font-semibold text-ink">Bids</h1>
      <p className="mb-6 text-sm text-ink-body">Every job you have been invited to price, soonest due first.</p>

      <section aria-labelledby="bid-due-soon" className="mb-10">
        <h2 id="bid-due-soon" className="mb-3 text-sm font-semibold text-ink-label">
          Due soon ({dueSoon.length})
        </h2>
        {dueSoon.length === 0 ? (
          <p className="text-sm text-ink-body">No invited bids due in the next 30 days.</p>
        ) : (
          <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface" data-bid="due-soon">
            {dueSoon.map((bid) => (
              <li key={bid.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{bid.projectName}</p>
                  <p className="text-sm text-ink-body">
                    {bid.gcName} · Due {formatCalendarDate(new Date(`${bid.dueIso}T00:00:00.000Z`), "numeric")}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-medium tabular-nums ${bid.daysLeft <= 7 ? "text-tag-amber-ink" : "text-ink-label"}`}
                >
                  {daysLeftLabel(bid.daysLeft)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BidComingSoon
        level={2}
        title="Log a bid, and every bid you have logged"
        purpose={
          <p>
            Logging an invite (the GC, the project, your trade, the due date), the full history with filters, and
            each bid&rsquo;s own page — addenda, the bid form&rsquo;s requirements, your quotes side by side, and why
            you won or lost.
          </p>
        }
      />
    </PageShell>
  );
}
