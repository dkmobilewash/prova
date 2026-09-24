import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { BidInvitationStatus, prisma, TradeScope } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { money } from "@/lib/money";
import { formatCalendarDate } from "@/lib/render-date";
import { summariseWonValue, valueIsPartial } from "@/lib/bid-pipeline";
import { BidLevelling, type BidQuoteRow } from "@/components/BidLevelling";
import { viewerToday } from "@/lib/viewerToday";
import { BidLines, type BidLineRow } from "@/components/BidLines";
import { BidJobLink } from "@/components/BidJobLink";
import { bidRecord, settledSentence } from "@/lib/bid-outcome";
import { loadBidOutcomes, loadLinkableJobs } from "@/lib/bid-outcome-query";

const TRADE_SCOPE_OPTIONS = [
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

const STATUS_OPTIONS = [
  { value: "INVITED", label: "Invited" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "DECLINED", label: "Declined" },
] as const;

const STATUS_STYLE: Record<string, string> = {
  INVITED: "bg-neutral-800 text-ink-label",
  SUBMITTED: "bg-tag-blue text-tag-blue-ink",
  WON: "bg-tag-green text-tag-green-ink",
  LOST: "bg-tag-rose text-red-400",
  DECLINED: "bg-neutral-800 text-ink-muted",
};

function labelFor(options: readonly { value: string; label: string }[], value: string | null) {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** A stored UTC midnight as the YYYY-MM-DD a date input round-trips, or null.
 * Rendered in UTC, never in the viewer's zone — the app-wide rule, and here it
 * is what stops a quote dated Tuesday reading as Monday in California. */
const day = (value: Date | null) => (value === null ? null : value.toISOString().slice(0, 10));

export default async function BidsPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string; status?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;
  const { trade, status } = await searchParams;

  const tradeFilter = trade && trade in TradeScope ? (trade as TradeScope) : undefined;
  const statusFilter = status && status in BidInvitationStatus ? (status as BidInvitationStatus) : undefined;

  // The reader's calendar, not the server's. A request is OVERDUE or it is
  // not, and that is exactly the case lib/serverToday.ts's own comment says
  // it is not good enough for: "on anything where the exact day decides an
  // outcome". Computed on the server from request data, so the markup
  // matches on both sides and the localToday hydration trap does not apply.
  const today = await viewerToday();

  const [vendors, outcomesByBid, linkableJobs] = await Promise.all([
    prisma.vendor.findMany({
      where: { companyId: company.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    loadBidOutcomes(company.id),
    loadLinkableJobs(company.id),
  ]);
  // How this company's finished bids have run against what the work cost.
  // Derived here, never stored, and it counts only what has SETTLED — see
  // `bidRecord`, which returns the excluded count so the sentence can say so.
  const record = bidRecord([...outcomesByBid.values()].map((linked) => linked.outcome));

  const bids = await prisma.bidInvitation.findMany({
    where: {
      companyId: company.id,
      tradeScope: tradeFilter,
      status: statusFilter,
    },
    orderBy: { createdAt: "desc" },
    include: {
      contact: true,
      quotes: { orderBy: [{ packageLabel: "asc" }, { amount: "asc" }] },
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });

  // #79: a WON bid with no bidAmount used to be dropped from both the sum
  // AND the count, so the figure read as a total when it was really a
  // floor -- and vanished with no explanation at all when every won bid
  // was unpriced. Reuses /pipeline's already-proven arithmetic
  // (lib/bid-pipeline.ts) instead of a second, disagreeing computation.
  const wonCount = bids.filter((b) => b.status === "WON").length;
  const wonValue = summariseWonValue(
    bids.map((b) => ({ status: b.status, bidAmount: b.bidAmount === null ? null : Number(b.bidAmount) })),
  );

  // "No bids match this filter" was shown on a brand-new account, where no
  // filter is set and nothing could match anything. The two states need
  // different sentences and only one of them is a dead end.
  //
  // NO EXTRA QUERY IS NEEDED to tell them apart: with neither filter
  // applied the query above is already unfiltered, so zero rows IS zero
  // bids. A count would be a second read that could only agree.
  const isFiltered = tradeFilter != null || statusFilter != null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Bid history</h1>
      <p className="mb-6 text-sm text-ink-body">
        Every bid invitation logged across every GC — filter by trade or outcome to see what similar
        work has priced at before.
      </p>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" data-tour="bids-filter">
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Trade
          <select
            name="trade"
            defaultValue={trade ?? ""}
            className="rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
          >
            <option value="">All trades</option>
            {TRADE_SCOPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
          >
            <option value="">Any status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
        >
          Filter
        </button>
        {(trade || status) && (
          <Link href="/bids" className="text-sm text-ink-body hover:underline">
            Clear
          </Link>
        )}
      </form>

      {/* "0 bids" above a box that already explains there are none is one
          number doing nothing. It stays for every other case. */}
      {(bids.length > 0 || isFiltered) && (
        <p className="mb-4 text-sm text-ink-body">
          {bids.length} bid{bids.length === 1 ? "" : "s"}
          {/* Renders whenever ANY bid is WON, priced or not -- a total that
              silently disappears because nobody went back and priced the win
              is worse than a total that says it is incomplete. */}
          {wonCount > 0 && (
            <>
              {" "}
              ·{" "}
              {valueIsPartial(wonValue) ? (
                <span className="text-tag-amber-ink">
                  at least {money(wonValue.valueWon)} in won bids — {wonValue.valueWonUnpriced} won{" "}
                  {wonValue.valueWonUnpriced === 1 ? "bid has" : "bids have"} no amount recorded
                </span>
              ) : (
                <>{money(wonValue.valueWon)} in won bids</>
              )}
            </>
          )}
        </p>
      )}

      {/* HOW THE BIDS HAVE ACTUALLY RUN. Only finished jobs count toward this:
          a job three weeks in has spent a fifth of its cost and earned none of
          its lessons, and averaging it in as "on budget" would make the figure
          read better the more work is in progress. The excluded count is shown
          rather than dropped, so the number can be judged. */}
      {record.settled > 0 && (
        <p className="mb-4 rounded-lg border border-line-card bg-surface-card p-3 text-sm text-ink-body">
          Across {record.settled} finished {record.settled === 1 ? "job" : "jobs"} linked to a bid, the work came in{" "}
          <span className="font-medium text-ink">
            {Math.abs(record.averageVariance! * 100) < 0.05
              ? "on the bid on average"
              : `${Math.abs(record.averageVariance! * 100).toFixed(1)}% ${record.averageVariance! > 0 ? "over" : "under"} on average`}
          </span>
          {record.over > 0 || record.under > 0 ? (
            <> — {record.over} over, {record.under} under.</>
          ) : (
            "."
          )}
          {record.notYet > 0 && (
            <span className="text-ink-muted">
              {" "}
              {record.notYet} more {record.notYet === 1 ? "bid is" : "bids are"} linked to a job that has not
              finished, and {record.notYet === 1 ? "is" : "are"} not counted here.
            </span>
          )}
        </p>
      )}

      {bids.length === 0 ? (
        isFiltered ? (
          <p className="text-ink-body">
            No bids match this filter.{" "}
            <Link href="/bids" className="text-link hover:text-brand">
              Show them all
            </Link>
            .
          </p>
        ) : (
          <EmptyState
            data-tour="bids-empty"
            title="No bids logged yet"
            purpose={
              <p>
                Everything you have been asked to price, who asked, and how it went — won, lost or
                still out. Once a few are in, filtering by type of work shows what similar jobs went
                for last time, which is the number you want when someone asks for a ballpark on the
                phone.
              </p>
            }
            actions={[{ label: "Open your contacts", href: "/contacts" }, { label: "See the pipeline", href: "/pipeline" }]}
            ask="Northside Builders invited us to bid the Oak Ave addition, due October 3"
            sources={
              <p>
                A bid is logged on the page of whoever asked for the price — a GC, a developer
                or a construction manager — under Bid invitations. Open the contact, or add them first.
              </p>
            }
            example={{
              rows: [
                { title: "Oak Ave addition", tag: "Submitted", detail: "Northside Builders · due Oct 3", meta: "$48,500" },
                { title: "Maple St. bathroom", tag: "Won", detail: "Jane Smith · decided Aug 20", meta: "$18,200" },
                { title: "Hillcrest deck", tag: "Lost", detail: "Ridge Homes · went $3,000 lower", meta: "$22,900" },
              ],
            }}
          />
        )
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="bids-list">
          {bids.map((bid) => (
            <li key={bid.id} className="p-4">
              <Link
                href={`/contacts/${bid.contactId}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{bid.projectName}</p>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[bid.status]}`}
                    >
                      {labelFor(STATUS_OPTIONS, bid.status)}
                    </span>
                  </div>
                  <p className="text-sm text-ink-body">
                    {bid.contact.name}
                    {bid.tradeScope && <> · {labelFor(TRADE_SCOPE_OPTIONS, bid.tradeScope)}</>}
                    {bid.dueDate && <> · Due {formatCalendarDate(bid.dueDate, "numeric")}</>}
                  </p>
                </div>
                {bid.bidAmount != null && (
                  <p className="text-sm font-medium text-ink">{money(Number(bid.bidAmount))}</p>
                )}
              </Link>
              <BidLines
                bidInvitationId={bid.id}
                base={bid.bidAmount === null ? null : Number(bid.bidAmount)}
                lines={bid.lines.map(
                  (line): BidLineRow => ({
                    id: line.id,
                    kind: line.kind,
                    label: line.label,
                    description: line.description,
                    amount: line.amount === null ? null : Number(line.amount),
                    unit: line.unit,
                    unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
                    accepted: line.accepted,
                  }),
                )}
              />
              <BidLevelling
                bidInvitationId={bid.id}
                vendors={vendors}
                today={today}
                quotes={bid.quotes.map(
                  (quote): BidQuoteRow => ({
                    id: quote.id,
                    packageLabel: quote.packageLabel,
                    vendorId: quote.vendorId,
                    vendorName: quote.vendorName,
                    // NULL STAYS NULL. `Number(null)` is 0, which would post a
                    // supplier who has not answered as a quote of nothing —
                    // and nothing sorts cheapest.
                    amount: quote.amount === null ? null : Number(quote.amount),
                    // Rendered from the stored UTC midnight as YYYY-MM-DD, the
                    // same string the date input round-trips.
                    quotedOn: day(quote.quotedOn),
                    requestedOn: day(quote.requestedOn),
                    dueBy: day(quote.dueBy),
                    declinedAt: day(quote.declinedAt),
                    exclusions: quote.exclusions,
                    notes: quote.notes,
                  }),
                )}
              />
              {bid.status === "WON" && (
                <BidJobLink
                  bidInvitationId={bid.id}
                  jobs={linkableJobs}
                  linked={
                    outcomesByBid.has(bid.id)
                      ? {
                          jobId: outcomesByBid.get(bid.id)!.jobId,
                          jobName: outcomesByBid.get(bid.id)!.jobName,
                          outcome: outcomesByBid.get(bid.id)!.outcome,
                        }
                      : null
                  }
                  sentence={
                    outcomesByBid.has(bid.id)
                      ? settledSentence(outcomesByBid.get(bid.id)!.outcome, money)
                      : null
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
