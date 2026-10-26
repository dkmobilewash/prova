import Link from "next/link";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { bidStandings, standingLines } from "@/lib/bid-standing";
import { bidCrowds, crowdingLines } from "@/lib/bid-crowding";
import { loadBidLog, loadBidPipeline } from "@/lib/bid-pipeline-query";
import { BidLogPanel } from "@/components/BidLogPanel";
import { valueIsPartial, winRateLabel } from "@/lib/bid-pipeline";
import { money } from "@/lib/money";
import { loadBidPursuits, loadLinkableInvitations } from "@/lib/bid-pursuits-query";
import { BidPursuitList } from "@/components/BidPursuitList";
import { ProjectLookup } from "@/components/ProjectLookup";
import { LeadSearch } from "@/components/LeadSearch";
import { CollapsedForm } from "@/components/CollapsedForm";
import { Disclosure } from "@/components/Disclosure";
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

  // ONE day for both halves of this page.
  //
  // The pursuit flags ("bid date passed", "soon", "untouched") were moved
  // to the READER'S calendar first, for a reason that was always just as
  // true of the invitations beside them: the create form's date floor is
  // localToday(), and on UTC's day an evening entry for tomorrow in Los
  // Angeles read as passed the moment it was saved. The invitations kept
  // the server's UTC day, "matching their own Ask tool" — so a bid due
  // TODAY was badged "past the date they asked for" from 17:00 Pacific,
  // and this page held two different answers to what day it is, eight
  // lines apart. The Ask tool it was matching was wrong in the same way.
  const today = await viewerToday();
  const [{ rows, live }, pursuits, invitations, bidLog] = await Promise.all([
    loadBidPipeline(context.company.id, today),
    loadBidPursuits(context.company.id, today),
    loadLinkableInvitations(context.company.id),
    // The bid log: bids per month, average bid, win rate and average contract,
    // derived on every read from the same invitations (lib/bid-pipeline.ts).
    loadBidLog(context.company.id, today),
  ]);

  // ── WHAT EACH LIVE BID NEEDS TODAY ──
  //
  // This was `live.filter((b) => b.overdue).length`, and `overdue` is
  // `dueDate < today` with NO STATUS IN IT. A bid submitted on time and
  // waiting on the GC — the normal state of every bid anybody has sent —
  // counted as overdue from the day after the deadline, forever. A desk with
  // ten bids out for award read "10 past the date they asked for" in red with
  // nothing wrong, and the one bid that was never sent was hiding in it.
  //
  // See `bid-standing.ts`. The three things that DO want somebody are kept
  // apart, because they want different people.
  const standings = bidStandings(live, today);
  const lines = standingLines(standings);
  // The same function's sentence for the missed bids alone, so the page can
  // pick that line out of `lines` without matching on its wording.
  const missedLine = standingLines({ dueSoon: [], missed: standings.missed, cold: [] })[0] ?? null;
  // ── AND THE WEEKS WITH TOO MUCH IN THEM ──
  //
  // `standingLines` is about bids that are already late or already cold. This
  // is the one that arrives EARLY ENOUGH TO ACT ON: the app knows what to do
  // once capacity has gone wrong (`CAPACITY` is a decline reason, and a regret
  // letter can name it) and has never said it was about to. See
  // `bid-crowding.ts` — it reports crowding and deliberately judges nothing.
  const crowding = crowdingLines(bidCrowds(live, today));
  // Keyed for the rows below, so a date is only coloured when its colour
  // carries a meaning somebody can act on.
  const byId = new Map(
    [...standings.dueSoon, ...standings.missed, ...standings.cold].map((one) => [one.bid.id, one.standing]),
  );

  // What feeds the chase list, as two buttons on one row, under the chase
  // list and Waiting on us (declutter, 2026-10-13: an open AI lookup form was
  // the first screen). Each is a billed set of web searches, so neither form
  // is open until pressed. BID_RESEARCH and LEAD_SEARCH had no control
  // anywhere until these — each ran only inside one Ask command. Neither
  // writes anything itself; the pursuit form is still the only writer here.
  const feeders = (
    <div className="mb-8 flex flex-wrap items-start gap-2 [&>div]:basis-full [&>section]:basis-full" data-pipeline="feeders">
      <CollapsedForm label="Look up a project">
        <ProjectLookup />
      </CollapsedForm>
      <LeadSearch />
    </div>
  );

  return (
    <PageShell width="working">
      <PageHeader
        route="/pipeline"
        title="Bid pipeline"
        subtitle="What you are chasing before anyone invites you, then who invites you to bid and what comes of it."
      />
      {/* The chase list first — it is what this page is for (declutter,
          2026-10-13: an open AI lookup form used to be the first screen). */}
      <BidPursuitList
        pursuits={pursuits}
        invitations={invitations}
        isOwner={context.role === "OWNER"}
      />

      {rows.length === 0 ? (
        <>
          {feeders}
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
                { title: "Crestview Development (owner's rep)", detail: "2 invitations · won 1", meta: "$18,200 won" },
                { title: "Waiting on us: Oak Ave addition", tag: "Due Oct 3", detail: "Northside Builders", meta: "5 days left" },
              ],
            }}
          />
        </>
      ) : (
        <>
          <section className="mb-8" data-tour="pipeline-waiting">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-sm font-medium text-ink-label">Waiting on us</h2>
            </div>

            {/* ONE LINE PER THING THAT WANTS DOING, above the list rather than
                beside a row: each is about the desk, not about one bid. The
                missed-deadline line is the one state that is actually wrong,
                so it is the red one — it used to be a red badge saying the
                same count again directly above it (declutter follow-up). */}
            {lines.length + crowding.length > 0 && (
              <ul data-pipeline="standings" className="mb-3 flex flex-col gap-1">
                {[...lines, ...crowding].map((line) => (
                  <li
                    key={line}
                    data-pipeline-missed={line === missedLine ? "" : undefined}
                    className={`rounded-md border p-2 text-xs ${
                      line === missedLine
                        ? "border-transparent bg-tag-rose text-tag-rose-ink"
                        : "border-line-card bg-surface text-ink-body"
                    }`}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            )}

            {live.length === 0 ? (
              <p className="rounded-xl border border-line-card bg-surface p-4 text-sm text-ink-body">
                Nothing outstanding — every invitation on file has been won, lost or declined.
              </p>
            ) : (
              <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface">
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
                          ? "bg-tag-brand text-tag-brand-ink"
                          : "bg-rail-hover text-ink-label"
                      }`}
                    >
                      {bidRow.status === "SUBMITTED" ? "Submitted" : "Invited"}
                    </span>
                    <span className="ml-auto text-sm text-ink-body">
                      {bidRow.dueDate === null ? (
                        <span className="text-ink-muted">no date given</span>
                      ) : (
                        // RED ONLY WHEN IT MEANS SOMETHING. `overdue` is
                        // `dueDate < today` with no status in it, so this used
                        // to redden the date on every submitted bid waiting on
                        // a GC — the normal state of a bid, shown as a problem.
                        <span
                          className={
                            byId.get(bidRow.id) === "MISSED"
                              ? "text-tag-rose-ink"
                              : byId.get(bidRow.id) === "DUE_SOON"
                                ? "text-tag-amber-ink"
                                : undefined
                          }
                        >
                          due {bidRow.dueDate}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {feeders}

          <BidLogPanel log={bidLog} />

          <section data-tour="pipeline-by-gc">
            <h2 className="mb-3 text-sm font-medium text-ink-label">By general contractor</h2>
            <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface">
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
                      <span className="rounded bg-tag-brand px-1.5 py-0.5 text-xs text-tag-brand-ink">
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

      <Disclosure summary="Where these figures come from" className="mt-8">
        <p className="text-sm text-ink-body">
          The chase list is its own record, kept here. Everything below it is worked out from the bid
          invitations listed on{" "}
          <Link href="/bids" className="text-link hover:underline">
            Bids
          </Link>
          , so correcting a bid moves these figures with it. A status or an amount is changed on the
          GC&apos;s own contact record, under &ldquo;Bid invitations&rdquo;.
        </p>
      </Disclosure>
    </PageShell>
  );
}
