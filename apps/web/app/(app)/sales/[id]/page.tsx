import { notFound } from "next/navigation";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { SalesLeadEditForm } from "@/components/SalesLeadEditForm";
import { SalesOpportunityForm } from "@/components/SalesOpportunityForm";
import { SalesOpportunityRow } from "@/components/SalesOpportunityRow";
import { SalesActivityForm } from "@/components/SalesActivityForm";
import { SalesActivityRow } from "@/components/SalesActivityRow";
import { OPPORTUNITY_STAGE_OPTIONS } from "@/components/SalesOpportunityFields";
import { toIsoDate } from "@/lib/compliance-expiry";
import { latestActivity, type LoggedActivity } from "@/lib/sales-activity";

export default async function SalesLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { company, ...currentUser } = await requireCompanyContext();

  if (!company.isProvaOperator) {
    notFound();
  }

  if (currentUser.role !== "OWNER") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-2 text-xl font-semibold text-slate-100">Owner only</h1>
        <p className="text-sm text-slate-400">
          The sales CRM is restricted to the account owner, same as Team management and billing
          settings.
        </p>
      </div>
    );
  }

  const lead = await prisma.salesLead.findUnique({
    where: { id },
    include: {
      opportunities: { orderBy: { createdAt: "desc" } },
      activities: {
        orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        include: { loggedByUser: { select: { name: true, email: true } } },
      },
    },
  });

  if (!lead || lead.companyId !== company.id) {
    notFound();
  }

  const opportunityOptions = lead.opportunities.map((opportunity) => ({
    id: opportunity.id,
    label: [
      OPPORTUNITY_STAGE_OPTIONS.find((o) => o.value === opportunity.stage)?.label ?? opportunity.stage,
      opportunity.estimatedMrr === null ? null : `$${opportunity.estimatedMrr.toString()}/mo`,
      toIsoDate(opportunity.expectedCloseDate),
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const loggedActivities: LoggedActivity[] = lead.activities.map((activity) => ({
    id: activity.id,
    type: activity.type,
    occurredOn: toIsoDate(activity.occurredOn) as string,
    followUpOn: toIsoDate(activity.followUpOn),
    createdAt: activity.createdAt.toISOString(),
  }));

  // Which row carries the live follow-up. Derived by the same function
  // /sales uses, rather than by "whatever the ORDER BY put first" — the
  // query's ordering and the rule must not be able to drift apart.
  const latestId = latestActivity(loggedActivities)?.id ?? null;

  const activityRows = lead.activities.map((activity) => ({
    id: activity.id,
    type: activity.type,
    occurredOn: toIsoDate(activity.occurredOn) as string,
    summary: activity.summary,
    followUpOn: toIsoDate(activity.followUpOn),
    opportunityId: activity.opportunityId,
    loggedByName: activity.loggedByUser?.name ?? activity.loggedByUser?.email ?? null,
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h1 className="mb-4 text-lg font-semibold text-slate-100">Edit lead</h1>
        <SalesLeadEditForm
          leadId={lead.id}
          defaults={{
            companyName: lead.companyName,
            contactName: lead.contactName,
            email: lead.email,
            phone: lead.phone,
            source: lead.source,
          }}
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Opportunities</h2>
        {lead.opportunities.length === 0 ? (
          <p className="mb-4 text-sm text-slate-400">No opportunities logged with {lead.companyName} yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-800 border-y border-slate-800">
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
              />
            ))}
          </ul>
        )}
        <SalesOpportunityForm leadId={lead.id} />
      </section>

      <section className="mt-10">
        <h2 className="mb-1 text-lg font-semibold text-slate-100">Activity</h2>
        <p className="mb-3 text-sm text-slate-400">
          Every call, email, demo and meeting on record. The follow-up on the most recent entry is
          what {lead.companyName} owes — an older entry&apos;s follow-up was superseded when the
          next activity was logged.
        </p>
        {activityRows.length === 0 ? (
          <p className="mb-4 text-sm text-slate-400">
            Nothing logged with {lead.companyName} yet. Until something is, this lead reads &ldquo;No
            contact logged&rdquo; on the list — which means nobody wrote it down, not that nobody
            called.
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-800 border-y border-slate-800">
            {activityRows.map((activity) => (
              <SalesActivityRow
                key={activity.id}
                activity={activity}
                opportunityOptions={opportunityOptions}
                isLatest={activity.id === latestId}
              />
            ))}
          </ul>
        )}
        <SalesActivityForm leadId={lead.id} opportunityOptions={opportunityOptions} />
      </section>
    </div>
  );
}
