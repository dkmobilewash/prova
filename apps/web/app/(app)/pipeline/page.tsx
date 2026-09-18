import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { loadBidPipeline } from "@/lib/bid-pipeline-query";
import { valueIsPartial, winRateLabel } from "@/lib/bid-pipeline";
import { money } from "@/lib/money";
import { loadBidPursuits, loadLinkableInvitations } from "@/lib/bid-pursuits-query";
import { BidPursuitList } from "@/components/BidPursuitList";
import { viewerToday } from "@/lib/viewerToday";

/**
 * The bidding relationship, per GC.
 *
 * /bids lists invitations one per row and filters them; this asks the
 * question that list cannot answer -- who keeps inviting us, what do we
 * do with it, and does it turn into work. Same data, and no writes to it:
 * every invitation status here is changed on the GC's contact page, which
 * owns BidInvitation.
 *
 * AND, AHEAD OF THAT, WHAT WE ARE CHASING BEFORE ANYBODY INVITES US.
 * BidPursuit (pursuits.prisma) is the head of the same pipeline -- the
 * projects we know are coming before a GC sends the invitation -- so it
 * lives here rather than on /bids, which is the HISTORY of what we were
 * asked to price. This section is the page's one write surface, and it
 * writes only BidPursuit; BidInvitation stays read-only here. It is never
 * SalesLead, which is Prova's own CRM and not any tenant's pipeline.
 */
export default async function PipelinePage() {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;

  const today = new Date().toISOString().slice(0, 10);
  // The pursuit flags ("bid date passed", "soon", "untouched") are judged on
  // the READER'S calendar: the create form's date floor is localToday(), and
  // on UTC's day an evening entry for tomorrow in Los Angeles read as passed
  // the moment it was saved. The bid_pursuits Ask tool uses the same call,
  // so the screen and the answer agree. The invitation figures below keep
  // `today` (UTC), unchanged, matching their own Ask tool.
  const pursuitDay = await viewerToday();
  const [{ rows, live }, pursuits, invitations] = await Promise.all([
    loadBidPipeline(context.company.id, today),
    loadBidPursuits(context.company.id, pursuitDay),
    loadLinkableInvitations(context.company.id),
  ]);

  const overdueCount = live.filter((b) => b.overdue).length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Bid pipeline</h1>
      <p className="mb-6 text-sm text-ink-body">
        What we are chasing before anyone has invited us, then who invites us to bid and what comes
        of it. The chase list is its own record, kept here. Everything below it is worked out from
        the bid invitations listed on {""}
        <Link href="/bids" className="text-link hover:underline">
          Bids
        </Link>
        . Those figures are not stored separately, so correcting a bid moves them with it —
        and a status or an amount is changed on the GC&apos;s own contact record, under
        &ldquo;Bid invitations&rdquo;, not on the Bids list, which only filters and reads.
      </p>

      <BidPursuitList
        pursuits={pursuits}
        invitations={invitations}
        isOwner={context.role === "OWNER"}
      />

      {rows.length === 0 ? (
        <EmptyState
          data-tour="pipeline-no-invitations"
          title="No bid invitations recorded yet"
          purpose={
            <p>
              Where your next jobs are coming from: who asks you to price work, how often you win
              it, and which bids are waiting on you. It fills in on its own from the bids you log —
              nothing here is typed twice.
            </p>
          }
          actions={[{ label: "Open your contacts", href: "/contacts" }, { label: "See all bids", href: "/bids" }]}
          ask="Northside Builders invited us to bid the Oak Ave addition, due October 3"
          sources={
            <p>
              Every bid invitation logged on a contact&apos;s page. The chase list above is separate
              — jobs you are after before anyone has asked you to bid.
            </p>
          }
          example={{
            caption: "What the pipeline looks like after a few months of bids. Not your data — nothing here is saved.",
            rows: [
              { title: "Northside Builders", detail: "9 invitations · won 4 · 44%", meta: "$186,000 won" },
              { title: "Jane Smith (homeowner)", detail: "2 invitations · won 1", meta: "$18,200 won" },
              { title: "Waiting on us: Oak Ave addition", tag: "Due Oct 3", detail: "Northside Builders", meta: "5 days left" },
            ],
          }}
        />
      ) : (
        <>
          <section className="mb-8" data-tour="pipeline-waiting">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-sm font-medium text-ink-label">Waiting on us</h2>
              {overdueCount > 0 && (
                <span className="rounded bg-tag-rose px-1.5 py-0.5 text-xs text-tag-rose-ink">
                  {overdueCount} past the date they asked for
                </span>
              )}
            </div>

            {live.length === 0 ? (
              <p className="rounded-lg border border-line-card bg-surface p-4 text-sm text-ink-body">
                Nothing outstanding — every invitation on file has been won, lost or declined.
              </p>
            ) : (
              <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
                {live.map((bidRow) => (
                  <li key={bidRow.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
                    <span className="text-ink">{bidRow.projectName}</span>
                    <Link
                      href={`/contacts/${bidRow.contactId}`}
                      className="text-sm text-link hover:underline"
                    >
                      {bidRow.contactName}
                    </Link>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        bidRow.status === "SUBMITTED"
                          ? "bg-tag-blue text-tag-blue-ink"
                          : "bg-neutral-800 text-ink-label"
                      }`}
                    >
                      {bidRow.status === "SUBMITTED" ? "Submitted" : "Invited"}
                    </span>
                    <span className="ml-auto text-sm text-ink-body">
                      {bidRow.dueDate === null ? (
                        <span className="text-ink-muted">no date given</span>
                      ) : (
                        <span className={bidRow.overdue ? "text-tag-rose-ink" : undefined}>
                          due {bidRow.dueDate}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section data-tour="pipeline-by-gc">
            <h2 className="mb-3 text-sm font-medium text-ink-label">By general contractor</h2>
            <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
              {rows.map((row) => (
                <li key={row.contactId} className="p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link
                      href={`/contacts/${row.contactId}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {row.contactName}
                    </Link>
                    {row.record.overdue > 0 && (
                      <span className="rounded bg-tag-rose px-1.5 py-0.5 text-xs text-tag-rose-ink">
                        {row.record.overdue} overdue
                      </span>
                    )}
                    {row.record.outstanding > 0 && row.record.overdue === 0 && (
                      <span className="rounded bg-tag-blue px-1.5 py-0.5 text-xs text-tag-blue-ink">
                        {row.record.outstanding} live
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-ink-body">
                    Invited {row.record.invited}
                    {" · "}bid {row.record.bid}
                    {row.record.declined > 0 && ` · declined ${row.record.declined}`}
                    {" · won "}
                    {row.record.won}
                    {" · lost "}
                    {row.record.lost}
                  </p>

                  <p className="mt-1 text-sm">
                    <span className="text-ink-body">Win rate </span>
                    <span
                      className={
                        row.record.winRate === null ? "text-ink-muted" : "text-ink-label"
                      }
                    >
                      {winRateLabel(row.record)}
                    </span>
                    {row.record.won > 0 && (
                      <>
                        <span className="text-ink-body"> · won </span>
                        <span className="text-ink-label">{money(row.record.valueWon)}</span>
                        {/* A sum that skipped rows must say so. /bids drops
                            unpriced won bids from its total silently, which
                            is the same shape as the $0.00 the browser test
                            found on the fringe report. */}
                        {valueIsPartial(row.record) && (
                          <span className="text-tag-amber-ink">
                            {" "}
                            at least — {row.record.valueWonUnpriced} won{" "}
                            {row.record.valueWonUnpriced === 1 ? "bid has" : "bids have"} no amount
                            recorded
                          </span>
                        )}
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
