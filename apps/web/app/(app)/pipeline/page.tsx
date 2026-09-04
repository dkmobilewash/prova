import Link from "next/link";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { loadBidPipeline } from "@/lib/bid-pipeline-query";
import { valueIsPartial, winRateLabel } from "@/lib/bid-pipeline";
import { money } from "@/lib/money";

/**
 * The bidding relationship, per GC.
 *
 * /bids lists invitations one per row and filters them; this asks the
 * question that list cannot answer -- who keeps inviting us, what do we
 * do with it, and does it turn into work. Same data, and no writes: every
 * status here is changed on /bids, which owns BidInvitation.
 */
export default async function PipelinePage() {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;

  const today = new Date().toISOString().slice(0, 10);
  const { rows, live } = await loadBidPipeline(context.company.id, today);

  const overdueCount = live.filter((b) => b.overdue).length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Bid pipeline</h1>
      <p className="mb-6 text-sm text-slate-400">
        Who invites us to bid, and what comes of it. Everything here is worked out from the bid
        invitations listed on {""}
        <Link href="/bids" className="text-blue-400 hover:underline">
          Bids
        </Link>
        . Nothing here is stored separately, so correcting a bid moves these figures with it —
        and a status or an amount is changed on the GC&apos;s own contact record, under
        &ldquo;Bid invitations&rdquo;, not on the Bids list, which only filters and reads.
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <p className="text-slate-300">No bid invitations recorded yet.</p>
          <p className="mt-2 text-sm text-slate-400">
            A GC appears here once they have invited you to bid at least once. Log one from{" "}
            <Link href="/contacts" className="text-blue-400 hover:underline">
              a contact&apos;s page
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <section className="mb-8">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-sm font-medium text-slate-200">Waiting on us</h2>
              {overdueCount > 0 && (
                <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">
                  {overdueCount} past the date they asked for
                </span>
              )}
            </div>

            {live.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
                Nothing outstanding — every invitation on file has been won, lost or declined.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
                {live.map((bidRow) => (
                  <li key={bidRow.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
                    <span className="text-slate-100">{bidRow.projectName}</span>
                    <Link
                      href={`/contacts/${bidRow.contactId}`}
                      className="text-sm text-blue-400 hover:underline"
                    >
                      {bidRow.contactName}
                    </Link>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        bidRow.status === "SUBMITTED"
                          ? "bg-blue-500/15 text-blue-300"
                          : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      {bidRow.status === "SUBMITTED" ? "Submitted" : "Invited"}
                    </span>
                    <span className="ml-auto text-sm text-slate-400">
                      {bidRow.dueDate === null ? (
                        <span className="text-slate-500">no date given</span>
                      ) : (
                        <span className={bidRow.overdue ? "text-red-300" : undefined}>
                          due {bidRow.dueDate}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-slate-200">By general contractor</h2>
            <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
              {rows.map((row) => (
                <li key={row.contactId} className="p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link
                      href={`/contacts/${row.contactId}`}
                      className="font-medium text-slate-100 hover:underline"
                    >
                      {row.contactName}
                    </Link>
                    {row.record.overdue > 0 && (
                      <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">
                        {row.record.overdue} overdue
                      </span>
                    )}
                    {row.record.outstanding > 0 && row.record.overdue === 0 && (
                      <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-xs text-blue-300">
                        {row.record.outstanding} live
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-slate-400">
                    Invited {row.record.invited}
                    {" · "}bid {row.record.bid}
                    {row.record.declined > 0 && ` · declined ${row.record.declined}`}
                    {" · won "}
                    {row.record.won}
                    {" · lost "}
                    {row.record.lost}
                  </p>

                  <p className="mt-1 text-sm">
                    <span className="text-slate-400">Win rate </span>
                    <span
                      className={
                        row.record.winRate === null ? "text-slate-500" : "text-slate-200"
                      }
                    >
                      {winRateLabel(row.record)}
                    </span>
                    {row.record.won > 0 && (
                      <>
                        <span className="text-slate-400"> · won </span>
                        <span className="text-slate-200">{money(row.record.valueWon)}</span>
                        {/* A sum that skipped rows must say so. /bids drops
                            unpriced won bids from its total silently, which
                            is the same shape as the $0.00 the browser test
                            found on the fringe report. */}
                        {valueIsPartial(row.record) && (
                          <span className="text-amber-300">
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
