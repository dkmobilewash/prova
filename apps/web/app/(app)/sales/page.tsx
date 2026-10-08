import Link from "next/link";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { SalesLeadForm } from "@/components/SalesLeadForm";
import { SubListingImport } from "@/components/SubListingImport";
import { CslbPhoneFill } from "@/components/CslbPhoneFill";
import { SalesLeadList } from "@/components/SalesLeadRow";
import { toIsoDate } from "@/lib/compliance-expiry";
import { viewerToday } from "@/lib/viewerToday";
import {
  countOverdue,
  followUpQueue,
  summarizeLeadActivity,
  type LeadActivitySource,
} from "@/lib/sales-activity";
import { SalesPipelineBand } from "@/components/SalesPipelineBand";
import {
  buildSalesPipeline,
  longestOpen,
  trackedOpenCount,
  type PipelineOpportunity,
} from "@/lib/sales-pipeline";
import {
  daysInCurrentStage,
  type RecordedStageChange,
} from "@/lib/sales-stage-history";
import { qualify } from "@/lib/sales-qualification";
import { callScoreboard } from "@/lib/call-dispositions";

/**
 * Prova's own sales pipeline -- for selling Prova itself, not a tenant's
 * GC/vendor relationships (that's /contacts). Gated on two independent
 * things, neither expressible as a lib/permissions.ts Capability: this
 * Company must be Prova's own operator (Company.isProvaOperator), and this
 * person must be its OWNER. A non-operator company sees nothing distinct
 * from any other page it hasn't been given a link to -- middleware still
 * requires sign-in, but nothing here names what the page would have shown.
 */
/**
 * `fillPhonesFromCslb` streams a 77 MB file from CSLB inside this page's server
 * action, and a server action runs under the segment config of the page that
 * invoked it. Ten seconds is not enough for that download; sixty is what the
 * repo's other long fetch (`api/plan-ingest/run`) already uses.
 */
export const maxDuration = 60;

export default async function SalesPage() {
  const { company, ...currentUser } = await requireCompanyContext();

  if (!company.isProvaOperator) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-2 text-xl font-semibold text-ink">
          Not part of your access
        </h1>
        <p className="text-sm text-ink-body">Nothing here for this account.</p>
      </div>
    );
  }

  if (currentUser.role !== "OWNER") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-2 text-xl font-semibold text-ink">Owner only</h1>
        <p className="text-sm text-ink-body">
          The sales CRM is restricted to the account owner, same as Team
          management and billing settings.
        </p>
      </div>
    );
  }

  const leads = await prisma.salesLead.findMany({
    where: { companyId: company.id },
    /* The band is derived per read and stored nowhere, so the ORDER somebody
       works down is decided after `qualify` runs — see `compareForCalling` in
       components/SalesLeadRow.tsx. This stays the newest-first order the list
       has always had, because it is also the comparator's tiebreak; `id`
       settles the ties, which an import produces 60 of at a time (every lead
       in one transaction shares `CURRENT_TIMESTAMP`). Without it Postgres may
       return tied rows in any order, so the page would be deterministic only
       by luck. */
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: {
      _count: { select: { opportunities: true } },
      /* Four fields, not three. `claim` is here because on a STRONG lead the
         band's reason IS the claim — "framing the Mission Valley job under
         Swinerton" is exactly what you want to read in a list of who to ring.
         Selecting only kind/state/disqualifies to save bytes rendered that
         reason as an EMPTY LINE, which is worse than the bytes. `sourceUrl`
         stays out: the list links to the lead, not to the page. */
      signals: {
        select: { kind: true, state: true, disqualifies: true, claim: true },
      },
      activities: {
        select: {
          id: true,
          type: true,
          occurredOn: true,
          followUpOn: true,
          createdAt: true,
        },
      },
      opportunities: {
        select: {
          id: true,
          stage: true,
          estimatedMrr: true,
          expectedCloseDate: true,
          stageChanges: {
            select: {
              id: true,
              fromStage: true,
              toStage: true,
              effectiveOn: true,
              note: true,
              recordedAt: true,
            },
          },
        },
      },
    },
  });

  // The viewer's calendar day, not the server's — a follow-up due today
  // reads OVERDUE to anyone west of UTC once the server has ticked over.
  const today = await viewerToday();

  const activitySources: LeadActivitySource[] = leads.map((lead) => ({
    leadId: lead.id,
    companyName: lead.companyName,
    activities: lead.activities.map((a) => ({
      id: a.id,
      type: a.type,
      occurredOn: toIsoDate(a.occurredOn) as string,
      followUpOn: toIsoDate(a.followUpOn),
      createdAt: a.createdAt.toISOString(),
    })),
  }));

  // Time in stage comes from the same derivation /sales/[id] uses, rather
  // than a second copy of the rule living here.
  const pipelineOpportunities: PipelineOpportunity[] = leads.flatMap((lead) =>
    lead.opportunities.map((opportunity) => {
      const changes: RecordedStageChange[] = opportunity.stageChanges.map(
        (change) => ({
          id: change.id,
          fromStage: change.fromStage,
          toStage: change.toStage,
          effectiveOn: toIsoDate(change.effectiveOn) as string,
          note: change.note,
          recordedAt: change.recordedAt.toISOString(),
        }),
      );

      return {
        id: opportunity.id,
        leadId: lead.id,
        companyName: lead.companyName,
        stage: opportunity.stage,
        // Decimal | null -> number | null. Never ?? 0: an unpriced deal is
        // not a deal worth nothing, and every total downstream depends on
        // the difference.
        estimatedMrr:
          opportunity.estimatedMrr === null
            ? null
            : Number(opportunity.estimatedMrr),
        expectedCloseDate: toIsoDate(opportunity.expectedCloseDate),
        daysInStage: daysInCurrentStage(changes, today),
      };
    }),
  );

  const pipeline = buildSalesPipeline(pipelineOpportunities, today);
  const sittingLongest = longestOpen(pipelineOpportunities, 3);
  // How many open deals that comparison was even drawn from -- see #153
  // finding 3. SalesPipelineBand needs this to say what "sitting longest"
  // was computed over instead of presenting it as a claim about everyone.
  const sittingLongestTrackedCount = trackedOpenCount(pipelineOpportunities);

  /* TODAY'S CALLS, by tag, for the scoreboard. A second small query rather
     than widening the per-lead select above to carry every summary ever
     written: the list needs dates and types for all history, the scoreboard
     needs summaries for one day. Dated on the viewer's today, like the
     follow-up queue. */
  const todaysCalls = await prisma.salesActivity.findMany({
    where: {
      companyId: company.id,
      type: "CALL",
      occurredOn: new Date(`${today}T00:00:00.000Z`),
    },
    select: { summary: true },
  });
  const board = callScoreboard(todaysCalls.map((call) => call.summary));

  const queue = followUpQueue(activitySources, today);
  const overdueCount = countOverdue(queue);
  const summaries = new Map(
    activitySources.map((source) => [
      source.leadId,
      summarizeLeadActivity(source, today),
    ]),
  );

  /**
   * One object per lead, with the band DERIVED here and stored nowhere — a
   * stored band would disagree with its own signals the moment one was
   * dismissed. The ordering lives in `SalesLeadList`, over these objects,
   * because the band cannot be an `ORDER BY`: there is no column.
   *
   * Hoisted out of the JSX rather than built inside the map, so that what the
   * list is sorted on and what the row renders are one object.
   */
  const rows = leads.map((lead) => {
    const q = qualify(lead.signals);
    const summary = summaries.get(lead.id);
    return {
      id: lead.id,
      companyName: lead.companyName,
      contactName: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      licenceNumber: lead.licenceNumber,
      city: lead.city,
      listedByGc: lead.listedByGc,
      opportunityCount: lead._count.opportunities,
      band: q.band,
      bandReason: q.reason,
      awaitingReview: q.awaitingReview,
      // Read only by the order, never rendered. ISO-8601 UTC, fixed width, so
      // the comparator's string compare is a chronological one.
      createdAt: lead.createdAt.toISOString(),
      lastContactOn: summary?.lastContactOn ?? null,
      daysSinceContact: summary?.daysSinceContact ?? null,
      followUpOn: summary?.followUpOn ?? null,
      followUpStanding: summary?.followUpStanding ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-1 text-lg font-semibold text-ink">Sales CRM</h1>
      <p className="mb-6 text-sm text-ink-body">
        Prospective C Stream customers and the deals in progress with them --
        internal, not visible to any tenant.
      </p>

      <SalesPipelineBand
        pipeline={pipeline}
        sittingLongest={sittingLongest}
        sittingLongestTrackedCount={sittingLongestTrackedCount}
      />

      {/* The day's dialing, derived from today's tagged CALL rows and stored
          nowhere. Dials / connects / conversations / meetings is the exact
          scoreboard the calling playbook asks for at the end of each day;
          "untagged" is a call somebody logged by hand without a disposition,
          counted as a dial and nothing else rather than guessed at. */}
      <section className="mb-6 rounded-lg border border-line-card bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Today&apos;s calls</h2>
          <Link href="/sales/call-list" className="text-xs text-ink-label hover:underline">
            Open the call list (CSLB) →
          </Link>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(
            [
              ["Dials", board.dials],
              ["Connects", board.connects],
              ["Conversations", board.conversations],
              ["Meetings booked", board.meetings],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-ink-muted">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        {board.untagged > 0 ? (
          <p className="mt-2 text-xs text-ink-muted">
            {board.untagged} call{board.untagged === 1 ? "" : "s"} logged without an
            outcome — counted as dials only.
          </p>
        ) : null}
      </section>

      {queue.length > 0 && (
        <section className="mb-6 rounded-lg border border-line-card bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">
            {queue.length} {queue.length === 1 ? "lead owes" : "leads owe"} a
            follow-up
            {overdueCount > 0 && (
              <span className="text-red-400"> — {overdueCount} overdue</span>
            )}
          </h2>
          <p className="mb-3 text-xs text-ink-muted">
            Read from each lead&apos;s most recent activity. Logging the next
            one with the follow-up date left blank is what takes a lead off this
            list.
          </p>
          <ul className="divide-y divide-line-row">
            {queue.map((row) => (
              <li
                key={row.leadId}
                className="flex items-center justify-between gap-3 py-2"
              >
                <Link
                  href={`/sales/${row.leadId}`}
                  className="text-sm text-ink-label hover:underline"
                >
                  {row.companyName}
                </Link>
                <span
                  className={`text-xs ${
                    row.followUpStanding === "OVERDUE"
                      ? "text-red-400"
                      : row.followUpStanding === "DUE_TODAY"
                        ? "text-tag-amber-ink"
                        : "text-ink-muted"
                  }`}
                >
                  {row.followUpStanding === "OVERDUE"
                    ? `${row.daysOverdue} ${row.daysOverdue === 1 ? "day" : "days"} overdue — was due ${row.followUpOn}`
                    : row.followUpStanding === "DUE_TODAY"
                      ? "Due today"
                      : `Due ${row.followUpOn}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="mb-4 text-sm text-ink-body">No leads recorded yet.</p>
      ) : (
        /* Ordered strongest band first, inside the component that renders the
           headings, so the order a person reads and the order the headings
           claim cannot disagree. `BAND_RANK` had no caller but its own test
           until this; see the header of components/SalesLeadRow.tsx. */
        <SalesLeadList leads={rows} />
      )}

      <div className="flex flex-col gap-3">
        <SalesLeadForm />
        {/* Reading a public listing sits beside adding a lead by hand, because
            it is the same decision made at a different scale: one company you
            heard about, or every sub a prime named on one job. */}
        <SubListingImport
          /* The two identifier columns travel with the name. They are what
             `leadCandidatesFor` matches a listed subcontractor on, and a lead
             whose licence collides with a pasted row is invisible to the
             reviewer without them. `findMany` above has no field `select`, so
             every scalar is already in hand and this adds no query. */
          leads={leads.map((lead) => ({
            id: lead.id,
            companyName: lead.companyName,
            licenceNumber: lead.licenceNumber,
            registrationNumber: lead.registrationNumber,
          }))}
        />
        {/* The step after reading a listing: the licence it printed becomes a
            number somebody can ring. Counted here, from rows already in hand,
            so the button can say how many leads it would touch before it is
            pressed. */}
        <CslbPhoneFill
          candidates={leads.filter((lead) => lead.licenceNumber && !lead.phone).length}
        />
      </div>
    </div>
  );
}
