import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { BidInvitationStatus, prisma, TradeScope } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { money } from "@/lib/money";
import { formatCalendarDate } from "@/lib/render-date";
import { summariseWonValue, valueIsPartial } from "@/lib/bid-pipeline";
import { summariseDeclines } from "@/lib/bid-decline";
import { BidLevelling, type BidQuoteRow } from "@/components/BidLevelling";
import { viewerToday, viewerTimeZone } from "@/lib/viewerToday";
import { todayInZone } from "@/lib/viewer-timezone";
import { BidLines, type BidLineRow } from "@/components/BidLines";
import type { AddendumItem } from "@/lib/addenda-overlap";
import {
  BidCompliance,
  type AddendumRow,
  type RequirementRow,
  type SpecSectionRow,
} from "@/components/BidCompliance";
import { findingsFromJson } from "@/lib/specs/spec-findings";
import { BidJobLink } from "@/components/BidJobLink";
import { BidProjectPanel } from "@/components/BidProjectPanel";
import { bidProjectInclude, loadProjectChoices } from "@/lib/bid-project-query";
import { projectPanelView } from "@/lib/bid-project-view";
import { bidRecord, settledSentence } from "@/lib/bid-outcome";
import { loadBidOutcomes, loadLinkableJobs } from "@/lib/bid-outcome-query";
import { BidOutcomeForm } from "@/components/BidOutcomeForm";
import { outcomeReasonLabel } from "@/components/ai-bid/outcome";
import { LogBidForm } from "@/components/LogBidForm";
import { Disclosure } from "@/components/Disclosure";
import { SeeAll, seeAllWindow } from "@/components/SeeAll";
import { bidsView, daysLeftLabel } from "@/lib/bids-due-soon";
import { loadBidsDueSoon } from "@/lib/bids-due-soon-query";
import { dayAndTime, upcomingBidDates } from "@/lib/bid-dates";
import { BidDetailsEdit } from "@/components/BidDetailsEdit";

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
  INVITED: "bg-rail-hover text-ink-label",
  SUBMITTED: "bg-tag-brand text-tag-brand-ink",
  WON: "bg-tag-green text-tag-green-ink",
  LOST: "bg-tag-rose text-danger",
  DECLINED: "bg-rail-hover text-ink-muted",
};

function labelFor(options: readonly { value: string; label: string }[], value: string | null) {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** A stored UTC midnight as the YYYY-MM-DD a date input round-trips, or null.
 * Rendered in UTC, never in the viewer's zone — the app-wide rule, and here it
 * is what stops a quote dated Tuesday reading as Monday in California. */
const day = (value: Date | null | undefined) => (value == null ? null : value.toISOString().slice(0, 10));

/** All bids shows the latest 20; `?all=1` lifts it (declutter round 2). */
const BIDS_SHOWN = 20;

export default async function BidsPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string; status?: string; new?: string; view?: string; all?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;
  const { trade, status, new: isNew, view: viewParam, all } = await searchParams;

  const tradeFilter = trade && trade in TradeScope ? (trade as TradeScope) : undefined;
  const statusFilter = status && status in BidInvitationStatus ? (status as BidInvitationStatus) : undefined;

  // The reader's calendar, not the server's. A request is OVERDUE or it is
  // not, and that is exactly the case lib/serverToday.ts's own comment says
  // it is not good enough for: "on anything where the exact day decides an
  // outcome". Computed on the server from request data, so the markup
  // matches on both sides and the localToday hydration trap does not apply.
  const today = await viewerToday();
  // THE READER'S ZONE, NOT THE SERVER'S, and this is a correction rather than a
  // flourish. `day()` above UTC-slices, which is right for every DATE field in
  // this app because those are stored at UTC midnight on purpose. A reading's
  // `createdAt` is a TIMESTAMP, and UTC-slicing one shows tomorrow's date to
  // anybody west of UTC in the evening: a browser click-through on the Pacific
  // evening of 2026-09-29 was told "Read 2026-09-30", which is a date that had
  // not happened where they were sitting.
  const zone = await viewerTimeZone();

  const [vendors, outcomesByBid, linkableJobs, gcs, projectChoices] = await Promise.all([
    prisma.vendor.findMany({
      where: { companyId: company.id },
      orderBy: { name: "asc" },
      // EMAIL AND CONTACT NAME, which nothing has ever selected. The column
      // has been on the model with a form field behind it on /vendors the
      // whole time, and a grep for a query reading it returned nothing — so
      // every supplier address a company typed in was write-only. Sending an
      // RFQ is the first thing that needs it.
      select: { id: true, name: true, email: true, contactName: true },
    }),
    loadBidOutcomes(company.id),
    loadLinkableJobs(company.id),
    // Who can have invited you: GCs and developers, and contacts nobody
    // typed (accountType is optional). Never a vendor or a sub.
    prisma.contact.findMany({
      where: {
        companyId: company.id,
        OR: [{ accountType: null }, { accountType: { in: ["GENERAL_CONTRACTOR", "DEVELOPER"] } }],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    loadProjectChoices(company.id),
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
      // THE LINKED JOB, READ HERE RATHER THAN INFERRED FROM THE OUTCOME.
      // `loadBidOutcomes` only returns WON bids — deliberately, so a lost or
      // in-progress bid never enters the bid-versus-actual comparison — so a
      // bid linked before it is won appears in no outcome map. Deriving the
      // link from that map made an already-linked bid render the "link" button
      // again, which is how the control came to be gated on WON in the first
      // place. The link is its own fact and is read as one.
      wonJob: { select: { id: true, name: true } },
      // The piece of work this invitation is for, with the other GCs on it
      // and the one estimate they share — see components/BidProjectPanel.tsx.
      bidProject: { include: bidProjectInclude },
      // Why it was won or lost (BidOutcome, ai-agents.prisma) — whether to
      // offer "Record why" below, or say the reason already recorded.
      outcome: { select: { reason: true } },
      quotes: { orderBy: [{ packageLabel: "asc" }, { amount: "asc" }] },
      lines: { orderBy: { sortOrder: "asc" } },
      // Addenda oldest first: they are read as a sequence, and the one you
      // have not acknowledged is usually the newest.
      addenda: {
        orderBy: [{ issuedOn: "asc" }, { createdAt: "asc" }],
        include: {
          // THE NEWEST READING ONLY. Readings are append-only — a re-read
          // inserts rather than overwrites, so a proposal an estimator worked
          // through is never rewritten — and the newest is the current one.
          // `_count` is what lets the button say how many times this has been
          // read BEFORE somebody presses it again and is charged again.
          readings: { orderBy: { createdAt: "desc" }, take: 1 },
          decisions: { select: { normalisedReference: true, decision: true } },
          _count: { select: { readings: true } },
        },
      },
      requirements: { orderBy: { createdAt: "asc" } },
      // Spec sections by their own number, which is how a book is ordered and
      // how an estimator asks for one. Same reading shape as the addenda above
      // and for the same two reasons: readings are append-only so the newest is
      // the current one, and `_count` is what lets the button say how many times
      // this has been read BEFORE somebody is charged again.
      specSections: {
        orderBy: [{ sectionNumber: "asc" }, { createdAt: "asc" }],
        include: {
          readings: { orderBy: { createdAt: "desc" }, take: 1 },
          _count: { select: { readings: true } },
        },
      },
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

  // ── WHY WE ARE NOT BIDDING WORK ──
  //
  // `DECLINED` has been a bare status since this model was written, so the page
  // could report a count and never a cause. Eight declines for capacity means
  // hire; eight for contract terms means one GC's paper is costing the
  // relationship. Same number, different decision.
  //
  // Computed over the bids ALREADY LOADED rather than a second query — the
  // rows are here, and a count that could only agree is a wasted trip. That
  // does mean it respects the filters above, which is right: filtering to one
  // trade and asking why those were declined is the useful version.
  //
  // `estimatedValue` is deliberately not read: `BidInvitation` has no such
  // column, and `bidAmount` is what WE bid — on a declined bid there is no
  // number, because declining is the decision not to produce one. So the
  // summary counts and never sums, and `bid-decline.ts` carries the value
  // field for a caller that has one.
  const declineSummary = summariseDeclines(
    bids
      .filter((b) => b.status === "DECLINED")
      .map((b) => ({ id: b.id, declineReason: b.declineReason, estimatedValue: null })),
  );

  // "No bids match this filter" was shown on a brand-new account, where no
  // filter is set and nothing could match anything. The two states need
  // different sentences and only one of them is a dead end.
  //
  // NO EXTRA QUERY IS NEEDED to tell them apart: with neither filter
  // applied the query above is already unfiltered, so zero rows IS zero
  // bids. A count would be a second read that could only agree.
  const isFiltered = tradeFilter != null || statusFilter != null;

  // THE CAP IS ON WHAT IS RENDERED, NOT ON WHAT IS READ. The count, the won
  // value and the decline line above all aggregate `bids`, every matching
  // row, and must keep doing so — a `take` on the query would quietly turn
  // each of them into "of the latest 20". So the query is unchanged and the
  // list is sliced. ponytail: still loads every bid's panels' data; a lean
  // aggregate query plus `take` on this one is the upgrade if /bids gets slow.
  const { take, limit, showingAll } = seeAllWindow(all, BIDS_SHOWN);
  const shownBids = take === undefined ? bids : bids.slice(0, take);
  const listParams = new URLSearchParams({ view: "all", ...(trade ? { trade } : {}), ...(status ? { status } : {}) });
  const fewerHref = `/bids?${listParams}`;
  listParams.set("all", "1");
  const allHref = `/bids?${listParams}`;

  // Read-only over the same rows: what is still to price, soonest first.
  // Its own query because the history filters above must not hide it.
  // Shared with C Stream Bid's /bid/bids — lib/bids-due-soon-query.ts.
  const dueSoon = await loadBidsDueSoon(company.id, today);
  const view = bidsView(viewParam, dueSoon.length, isFiltered);
  const viewTab = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${active ? "bg-rail-hover text-ink" : "text-ink-body hover:text-ink"}`;

  return (
    <PageShell width="working">
      <PageHeader
        route="/bids"
        title="Bid history"
        subtitle="Every bid invitation from every GC — filter by trade or outcome to see what similar work priced at."
      />

      <LogBidForm gcs={gcs} startOpen={isNew === "1"} projectChoices={projectChoices} />

      {/* ── THE DECLINE PICTURE, WHEN THERE IS ONE ──

          Absent entirely with no declines, rather than a panel reading zero:
          a sub who has declined nothing does not need a heading about it, and
          an empty panel on every account trains people to skip the area.

          No verdict, no target, no flag on a GC who gets declined often. The
          house rule — `bid-responsiveness.ts` says it of itself. A sub
          declining most invitations may be correctly busy, and an app that
          nagged about it would be wrong most of the time while sounding
          authoritative. */}
      {declineSummary.headline !== null && (
        <p className="mb-4 text-sm text-ink-body" data-bids="decline-summary">
          <span className="font-semibold text-ink-label">Work turned down:</span> {declineSummary.headline}
          {declineSummary.groups.length > 1 && (
            <span className="text-ink-muted">
              {" "}
              {declineSummary.groups.map((group) => `${group.label} ${group.count} ${group.count === 1 ? "bid" : "bids"}`).join(" · ")}
              .
            </span>
          )}{" "}
          {/* SAID OUT LOUD, never folded into "Something else" — and asked
              for, never required, so the unrecorded count is how much of the
              picture is missing rather than a figure to drive to zero. */}
          {declineSummary.unrecorded > 0 && (
            <span className="text-ink-muted">Reasons are asked for, never required. </span>
          )}
          <Link href="/bids?view=all&status=DECLINED" className="text-link hover:text-link-hover hover:underline">
            See the declined bids
          </Link>
        </p>
      )}

      <nav aria-label="Bid views" className="mb-4 flex gap-1" data-bids="views">
        <Link href="/bids?view=due" aria-current={view === "due" ? "page" : undefined} className={viewTab(view === "due")}>
          Due soon ({dueSoon.length})
        </Link>
        <Link href="/bids?view=all" aria-current={view === "all" ? "page" : undefined} className={viewTab(view === "all")}>
          All bids
        </Link>
      </nav>

      {view === "due" ? (
        dueSoon.length === 0 ? (
          <p className="text-sm text-ink-body">
            No invited bids due in the next 30 days.{" "}
            <Link href="/bids?view=all" className="text-link hover:text-link-hover">
              See all bids
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface" data-bids="due-soon">
            {dueSoon.map((bid) => (
              <li key={bid.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="min-w-0">
                  <Link href={`/ai/bids/${bid.id}`} className="font-medium text-ink hover:underline">
                    {bid.projectName}
                  </Link>
                  <p className="text-sm text-ink-body">
                    {bid.gcName} · Due {dayAndTime(bid.dueIso, bid.dueMinute)},{" "}
                    {formatCalendarDate(new Date(`${bid.dueIso}T00:00:00.000Z`), "numeric")}
                  </p>
                  {bid.upcoming.map((u) => (
                    <p key={u.kind} className="text-sm font-medium text-tag-amber-ink" data-bids={`upcoming-${u.kind}`}>
                      {u.label}
                    </p>
                  ))}
                </div>
                <span
                  className={`shrink-0 text-sm font-medium tabular-nums ${bid.daysLeft <= 7 ? "text-tag-amber-ink" : "text-ink-label"}`}
                >
                  {daysLeftLabel(bid.daysLeft)}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
      <>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" data-tour="bids-filter">
        <input type="hidden" name="view" value="all" />
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
          className="inline-flex items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover"
        >
          Filter
        </button>
        {(trade || status) && (
          <Link href="/bids?view=all" className="text-sm text-ink-body hover:underline">
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
            <Link href="/bids?view=all" className="text-link hover:text-link-hover">
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
        <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface" data-tour="bids-list">
          {shownBids.map((bid) => (
            <li key={bid.id} id={bid.id} className="scroll-mt-24 p-4 target:ring-2 target:ring-inset target:ring-brand">
              {/* The name opens the bid's own page (Research, Estimate check,
                  Addenda, Decision); the GC's name opens the GC. Two links, not
                  one wrapping the row — a link inside a link is invalid. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/ai/bids/${bid.id}`} className="inline-flex min-h-11 items-center font-medium text-ink hover:underline mouse:min-h-0">
                      {bid.projectName}
                    </Link>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[bid.status]}`}
                    >
                      {labelFor(STATUS_OPTIONS, bid.status)}
                    </span>
                  </div>
                  <p className="text-sm text-ink-body">
                    <Link href={`/contacts/${bid.contactId}`} className="hover:underline">
                      {bid.contact.name}
                    </Link>
                    {bid.tradeScope && <> · {labelFor(TRADE_SCOPE_OPTIONS, bid.tradeScope)}</>}
                    {bid.dueDate && (
                      <>
                        {" "}
                        · Due {dayAndTime(day(bid.dueDate)!, bid.dueMinute)},{" "}
                        {formatCalendarDate(bid.dueDate, "numeric")}
                      </>
                    )}
                    {bid.walkDate && (
                      <>
                        {" "}
                        · Job walk {dayAndTime(day(bid.walkDate)!, bid.walkMinute)},{" "}
                        {formatCalendarDate(bid.walkDate, "numeric")}
                      </>
                    )}
                    {bid.rfiCutoffDate && <> · RFIs close {formatCalendarDate(bid.rfiCutoffDate, "numeric")}</>}
                  </p>
                  {/* A walk or RFI cutoff inside a week, on a bid still being
                      priced. A won or lost bid's cutoff is history, not news. */}
                  {(bid.status === "INVITED" || bid.status === "SUBMITTED") &&
                    upcomingBidDates(bid, today).map((u) => (
                      <p key={u.kind} className="text-sm font-medium text-tag-amber-ink" data-bids={`upcoming-${u.kind}`}>
                        {u.label}
                      </p>
                    ))}
                </div>
                {bid.bidAmount != null && (
                  <p className="text-sm font-medium text-ink">{money(Number(bid.bidAmount))}</p>
                )}
              </div>
              {bid.bidProject && (
                <BidProjectPanel
                  view={projectPanelView(bid.bidProject, bid, money)}
                  projectChoices={projectChoices}
                  gcs={gcs}
                />
              )}
              {/* ── CORRECT THE BID AFTER AN ADDENDUM ──
                  Name, trade, amount, notes and every date. Collapsed behind
                  its link like every list-page edit. The GC and the status are
                  not here: the GC is who invited you, and status has its own
                  form. */}
              <div className="px-4 pb-2" data-bids="edit-details">
                <BidDetailsEdit
                  bidInvitationId={bid.id}
                  defaults={{
                    projectName: bid.projectName,
                    tradeScope: bid.tradeScope,
                    dueDate: day(bid.dueDate),
                    dueMinute: bid.dueMinute,
                    walkDate: day(bid.walkDate),
                    walkMinute: bid.walkMinute,
                    rfiCutoffDate: day(bid.rfiCutoffDate),
                    bidAmount: bid.bidAmount === null ? null : bid.bidAmount.toString(),
                    notes: bid.notes,
                  }}
                />
              </div>
              {/* ── THE REGRET LETTER, ON A DECLINED BID ONLY ──

                  A page nothing links to is a page nobody uses — #665's lesson,
                  and the reason this link exists at all rather than the route
                  being reachable only by typing it.

                  Shown only on DECLINED. The letter renders for any bid, on
                  purpose, because somebody may write it before changing the
                  status — but a "decline to bid" link on a bid being actively
                  priced is an invitation to misread the row. */}
              {bid.status === "DECLINED" && (
                <div className="px-4 pb-3">
                  <Link
                    href={`/bids/${bid.id}/regret`}
                    data-bids="regret-link"
                    className="text-xs text-link hover:underline"
                  >
                    Write the regret letter →
                  </Link>
                </div>
              )}
              {/* WHY IT WAS WON OR LOST, on a decided bid only — the fact the
                  bid recommendations learn from (BidOutcomeForm). Collapsed
                  behind "Record why", per the list-page convention. */}
              {(bid.status === "WON" || bid.status === "LOST") && (
                <div className="pt-2" data-bids="outcome-why">
                  {bid.outcome ? (
                    <p className="text-sm text-ink-muted">Why: {outcomeReasonLabel(bid.outcome.reason)}</p>
                  ) : (
                    <BidOutcomeForm bidInvitationId={bid.id} defaultResult={bid.status} collapsed />
                  )}
                </div>
              )}
              {/* THE ROW'S WORKING PANELS, ONE CLICK DOWN. Lines, compliance,
                  supplier levelling and the job link used to render open under
                  every bid, so a list of 40 bids was 40 mini workspaces. They
                  are unchanged — same components, same props — just behind
                  this row disclosure, one open at a time. /ai/bids/[id] does
                  NOT render these four (BidWorkspace renders only
                  BidOutcomeForm), which is why they live here and not there. */}
              <Disclosure
                variant="row"
                name="bid"
                className="mt-2"
                summary={
                  bid.lines.length + bid.addenda.length + bid.quotes.length === 0 && !bid.wonJob ? (
                    // Nothing in it yet: the row still opens (it is how lines,
                    // addenda and quotes get ADDED), but a string of zeros is
                    // noise on every empty row.
                    <span data-bids="row-panels">Add lines, addenda, quotes or link the job</span>
                  ) : (
                    <span data-bids="row-panels">
                      Lines, addenda, quotes and job
                      <span className="text-ink-muted">
                        {" "}
                        · {bid.lines.length} {bid.lines.length === 1 ? "line" : "lines"} · {bid.addenda.length}{" "}
                        {bid.addenda.length === 1 ? "addendum" : "addenda"} · {bid.quotes.length}{" "}
                        {bid.quotes.length === 1 ? "quote" : "quotes"} · {bid.wonJob ? `job: ${bid.wonJob.name}` : "no job linked"}
                      </span>
                    </span>
                  )
                }
              >
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
              <BidCompliance
                bidInvitationId={bid.id}
                today={today}
                // The SAME rows BidLines renders, so the derived checks and
                // the list a person is looking at cannot disagree about what
                // is priced. Mapped twice rather than shared because the two
                // components want different shapes; the source is one query.
                lines={bid.lines.map((line) => ({
                  id: line.id,
                  kind: line.kind,
                  label: line.label,
                  amount: line.amount === null ? null : Number(line.amount),
                  unit: line.unit,
                  unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
                  accepted: line.accepted,
                }))}
                companyId={company.id}
                addenda={bid.addenda.map(
                  (row): AddendumRow => ({
                    id: row.id,
                    reference: row.reference,
                    issuedOn: day(row.issuedOn),
                    acknowledgedOn: day(row.acknowledgedOn),
                    affectsPricedScope: row.affectsPricedScope,
                    impactNote: row.impactNote,
                    notes: row.notes,
                    fileName: row.fileName,
                    // The URL itself never reaches the browser: the row only
                    // needs to know whether there IS one, and a public blob
                    // address is not something to hand out with the page.
                    hasFile: row.fileUrl !== null,
                    reading: row.readings[0]
                      ? {
                          id: row.readings[0].id,
                          items: (row.readings[0].items ?? []) as AddendumItem[],
                          readingReason: row.readings[0].readingReason,
                          proposedIssueDateText: row.readings[0].proposedIssueDateText,
                          proposedBidDateText: row.readings[0].proposedBidDateText,
                          // Rendered here, in UTC, like every other date on this
                          // page — `dateRenderCensus` fails a date the browser
                          // formats for itself.
                          readOn: todayInZone(zone, row.readings[0].createdAt),
                          pagesCharged: row.readings[0].pagesCharged,
                        }
                      : null,
                    readCount: row._count.readings,
                    decisions: row.decisions,
                  }),
                )}
                requirements={bid.requirements.map(
                  (row): RequirementRow => ({
                    id: row.id,
                    kind: row.kind,
                    label: row.label,
                    required: row.required,
                    satisfiedOn: day(row.satisfiedOn),
                    notes: row.notes,
                  }),
                )}
                specSections={bid.specSections.map(
                  (row): SpecSectionRow => ({
                    id: row.id,
                    sectionNumber: row.sectionNumber,
                    title: row.title,
                    notes: row.notes,
                    fileName: row.fileName,
                    // The URL itself never reaches the browser, for the reason
                    // the addenda mapping gives above: the row only needs to
                    // know whether there IS one, and a public blob address is
                    // not something to hand out with the page.
                    hasFile: row.fileUrl !== null,
                    reading: row.readings[0]
                      ? {
                          id: row.readings[0].id,
                          // NARROWED, not cast. `findings` is a `Json` column,
                          // so a row written by an older prompt version would
                          // otherwise reach the screen unchecked and render
                          // "undefined" as a finding's kind on a bid page.
                          findings: findingsFromJson(row.readings[0].findings),
                          readingReason: row.readings[0].readingReason,
                          // Rendered here, in UTC, like every other date on this
                          // page — `dateRenderCensus` fails a date the browser
                          // formats for itself.
                          readOn: todayInZone(zone, row.readings[0].createdAt),
                          pagesCharged: row.readings[0].pagesCharged,
                        }
                      : null,
                    readCount: row._count.readings,
                  }),
                )}
              />
              <BidLevelling
                companyId={company.id}
                bidInvitationId={bid.id}
                vendors={vendors}
                companyName={company.name}
                projectName={bid.projectName}
                /* ONLY WHAT HAS A FILE. A spec section or addendum logged
                   without its PDF is the normal case, not an error, and
                   offering one that cannot be attached would be a tick box
                   that silently sends nothing. */
                sendable={[
                  ...bid.specSections
                    .filter((section) => section.fileUrl)
                    .map((section) => ({
                      id: section.id,
                      kind: "SPEC_SECTION" as const,
                      label: section.sectionNumber,
                    })),
                  ...bid.addenda
                    .filter((addendum) => addendum.fileUrl)
                    .map((addendum) => ({
                      id: addendum.id,
                      kind: "ADDENDUM" as const,
                      label: addendum.reference,
                    })),
                ]}
                today={today}
                bidDueDate={day(bid.dueDate)}
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
                    carriedAt: day(quote.carriedAt),
                    validUntil: day(quote.validUntil),
                    exclusions: quote.exclusions,
                    notes: quote.notes,
                  }),
                )}
              />
              {/* NOT GATED ON WON, and that is the whole point of the control.
                  A quote is carried, and a job's estimate is built, BEFORE
                  anybody knows whether the bid was won — so a link only
                  offered on a won bid is offered after every decision it
                  exists to serve. `linkBidToJob` dropped its own WON check
                  with #619; this gate stayed and made that unreachable, which
                  no census could see: the action HAS a caller, and
                  reachability of the caller is a different question.

                  The comparison inside stays won-only regardless, because
                  `outcome` is null until there is one. */}
              <BidJobLink
                bidInvitationId={bid.id}
                jobs={linkableJobs}
                linked={
                  bid.wonJob
                    ? {
                        jobId: bid.wonJob.id,
                        jobName: bid.wonJob.name,
                        outcome: outcomesByBid.get(bid.id)?.outcome ?? null,
                      }
                    : null
                }
                sentence={
                  outcomesByBid.has(bid.id)
                    ? settledSentence(outcomesByBid.get(bid.id)!.outcome, money)
                    : null
                }
              />
              </Disclosure>
            </li>
          ))}
        </ul>
      )}
      {bids.length > 0 && (
        <SeeAll total={bids.length} limit={limit} showingAll={showingAll} noun="bids" href={allHref} fewerHref={fewerHref} />
      )}
      </>
      )}
    </PageShell>
  );
}
