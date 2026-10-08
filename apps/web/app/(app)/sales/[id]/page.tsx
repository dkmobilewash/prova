import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { SalesLeadEditForm } from "@/components/SalesLeadEditForm";
import { SalesOpportunityForm } from "@/components/SalesOpportunityForm";
import { SalesOpportunityRow } from "@/components/SalesOpportunityRow";
import { SalesActivityForm } from "@/components/SalesActivityForm";
import { CallLogButtons } from "@/components/CallLogButtons";
import { doNotCallFrom } from "@/lib/call-dispositions";
import { SalesActivityRow } from "@/components/SalesActivityRow";
import { SalesLeadSignals } from "@/components/SalesLeadSignals";
import { SalesLeadRegistry } from "@/components/SalesLeadRegistry";
import { toIsoDate } from "@/lib/compliance-expiry";
import { openFollowUp, type LoggedActivity } from "@/lib/sales-activity";
import { viewerToday } from "@/lib/viewerToday";
import {
  OPPORTUNITY_STAGE_OPTIONS,
  currentStageSince,
  daysInCurrentStage,
  historyDisagrees,
  isFutureDated,
  stageSpells,
  type RecordedStageChange,
} from "@/lib/sales-stage-history";

export default async function SalesLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { company, ...currentUser } = await requireCompanyContext();

  if (!company.isProvaOperator) {
    notFound();
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

  const lead = await prisma.salesLead.findUnique({
    where: { id },
    include: {
      opportunities: {
        orderBy: { createdAt: "desc" },
        include: { stageChanges: true },
      },
      activities: {
        orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        include: { loggedByUser: { select: { name: true, email: true } } },
      },
      signals: {
        orderBy: [{ foundAt: "desc" }, { createdAt: "desc" }],
        include: { reviewedByUser: { select: { name: true, email: true } } },
      },
    },
  });

  if (!lead || lead.companyId !== company.id) {
    notFound();
  }

  // The viewer's calendar day, not the server's — a deal that moved today
  // reads as moving tomorrow to anyone west of UTC once the server ticks over.
  const today = await viewerToday();

  const historyByOpportunity = new Map(
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

      return [
        opportunity.id,
        {
          stageSince: currentStageSince(changes),
          daysInStage: daysInCurrentStage(changes, today),
          futureDated: isFutureDated(changes, today),
          disagrees: historyDisagrees(changes, opportunity.stage),
          spells: stageSpells(changes, today),
        },
      ];
    }),
  );

  const opportunityOptions = lead.opportunities.map((opportunity) => ({
    id: opportunity.id,
    label: [
      OPPORTUNITY_STAGE_OPTIONS.find((o) => o.value === opportunity.stage)
        ?.label ?? opportunity.stage,
      opportunity.estimatedMrr === null
        ? null
        : `$${opportunity.estimatedMrr.toString()}/mo`,
      toIsoDate(opportunity.expectedCloseDate),
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const loggedActivities: LoggedActivity[] = lead.activities.map(
    (activity) => ({
      id: activity.id,
      type: activity.type,
      occurredOn: toIsoDate(activity.occurredOn) as string,
      followUpOn: toIsoDate(activity.followUpOn),
      createdAt: activity.createdAt.toISOString(),
    }),
  );

  // Which row carries the live follow-up — asked of the same function
  // /sales asks, rather than re-deciding it from the ORDER BY. The two
  // must not be able to drift apart, and a future-dated row must not win
  // here either.
  const liveFollowUpId =
    openFollowUp(loggedActivities, today)?.activityId ?? null;

  const activityRows = lead.activities.map((activity) => ({
    id: activity.id,
    type: activity.type,
    occurredOn: toIsoDate(activity.occurredOn) as string,
    summary: activity.summary,
    followUpOn: toIsoDate(activity.followUpOn),
    opportunityId: activity.opportunityId,
    loggedByName:
      activity.loggedByUser?.name ?? activity.loggedByUser?.email ?? null,
    // Rows created before createSalesActivity refused future dates. They
    // are read as not-yet-happened everywhere else, so they say so here.
    hasOccurred: (toIsoDate(activity.occurredOn) as string) <= today,
  }));

  const signalRows = lead.signals.map((signal) => ({
    id: signal.id,
    kind: signal.kind,
    state: signal.state,
    claim: signal.claim,
    sourceUrl: signal.sourceUrl,
    sourceTitle: signal.sourceTitle,
    disqualifies: signal.disqualifies,
    // Name over email, like every other row on this page. Null is "nobody has
    // reviewed it", which the row renders as nothing rather than as "unknown".
    reviewedByName:
      signal.reviewedByUser?.name ?? signal.reviewedByUser?.email ?? null,
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <section className="mb-10 rounded-lg border border-line-card bg-surface p-6">
        <h1 className="mb-4 text-lg font-semibold text-ink">Edit lead</h1>
        <SalesLeadEditForm
          leadId={lead.id}
          defaults={{
            companyName: lead.companyName,
            contactName: lead.contactName,
            email: lead.email,
            phone: lead.phone,
            source: lead.source,
            licenceNumber: lead.licenceNumber,
            city: lead.city,
          }}
        />
      </section>

      {/* ABOVE the deal and its history on purpose: this is what somebody
          reads BEFORE deciding to act, and the band's reason is the sentence
          they open the call with. Opportunities and Activity are what happened
          next. */}
      <SalesLeadSignals leadId={lead.id} signals={signalRows} />

      {/* UNDER "What we know" and above the deals, because it is the same
          question one step further on: the signals say whether this lead is
          worth a call, and this says whether a call is possible at all. On an
          imported lead there is no phone number and the licence is the only
          route to one. */}
      <SalesLeadRegistry
        lead={{
          licenceNumber: lead.licenceNumber,
          registrationNumber: lead.registrationNumber,
          city: lead.city,
          listedByGc: lead.listedByGc,
          listedOnProject: lead.listedOnProject,
          phone: lead.phone,
        }}
      />

      {/* The artifact every touch in the calling playbook points to: this
          firm's name on a WH-347 built the way the product builds a real one,
          stamped SAMPLE. One link, because the page it opens explains itself. */}
      <p className="mt-3 text-sm">
        <Link href={`/sales/${lead.id}/sample-wh347`} className="text-ink-label hover:underline">
          Sample WH-347 for {lead.companyName} →
        </Link>
      </p>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-ink">Opportunities</h2>
        {lead.opportunities.length === 0 ? (
          <p className="mb-4 text-sm text-ink-body">
            No opportunities logged with {lead.companyName} yet.
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-line-row border-y border-line-row">
            {lead.opportunities.map((opportunity) => (
              <SalesOpportunityRow
                key={opportunity.id}
                opportunity={{
                  id: opportunity.id,
                  stage: opportunity.stage,
                  estimatedMrr: opportunity.estimatedMrr?.toString() ?? null,
                  expectedCloseDate: toIsoDate(opportunity.expectedCloseDate),
                  notes: opportunity.notes,
                }}
                history={
                  historyByOpportunity.get(opportunity.id) ?? {
                    stageSince: null,
                    daysInStage: null,
                    futureDated: false,
                    disagrees: false,
                    spells: [],
                  }
                }
              />
            ))}
          </ul>
        )}
        <SalesOpportunityForm leadId={lead.id} />
      </section>

      <section className="mt-10">
        <h2 className="mb-1 text-lg font-semibold text-ink">Activity</h2>
        <p className="mb-3 text-sm text-ink-body">
          Every call, email, demo and meeting on record. The follow-up on the
          most recent entry is what {lead.companyName} owes — an older
          entry&apos;s follow-up was superseded when the next activity was
          logged.
        </p>
        {/* DERIVED from the latest CALL's tag, stored nowhere — the column is
            announced but not landed, and a flag that could disagree with the
            row it came from is the thing this repo refuses to store. */}
        {doNotCallFrom(lead.activities) ? (
          <p className="mb-3 rounded-md border border-tag-rose-ink px-3 py-2 text-sm font-semibold text-tag-rose-ink">
            {lead.companyName} asked not to be called. Do not dial this lead
            again; log a conversation only if they reach out.
          </p>
        ) : null}
        <div className="mb-4">
          <CallLogButtons leadId={lead.id} />
        </div>
        {activityRows.length === 0 ? (
          <p className="mb-4 text-sm text-ink-body">
            Nothing logged with {lead.companyName} yet. Until something is, this
            lead reads &ldquo;No contact logged&rdquo; on the list — which means
            nobody wrote it down, not that nobody called.
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-line-row border-y border-line-row">
            {activityRows.map((activity) => (
              <SalesActivityRow
                key={activity.id}
                activity={activity}
                opportunityOptions={opportunityOptions}
                isLatest={activity.id === liveFollowUpId}
              />
            ))}
          </ul>
        )}
        <SalesActivityForm
          leadId={lead.id}
          opportunityOptions={opportunityOptions}
        />
      </section>
    </div>
  );
}
