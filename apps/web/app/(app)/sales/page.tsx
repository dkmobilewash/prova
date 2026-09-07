import Link from "next/link";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { SalesLeadForm } from "@/components/SalesLeadForm";
import { SalesLeadRow } from "@/components/SalesLeadRow";
import { toIsoDate } from "@/lib/compliance-expiry";
import { viewerToday } from "@/lib/viewerToday";
import {
  countOverdue,
  followUpQueue,
  summarizeLeadActivity,
  type LeadActivitySource,
} from "@/lib/sales-activity";
import { SalesPipelineBand } from "@/components/SalesPipelineBand";
import { buildSalesPipeline, longestOpen, type PipelineOpportunity } from "@/lib/sales-pipeline";
import { daysInCurrentStage, type RecordedStageChange } from "@/lib/sales-stage-history";

/**
 * Prova's own sales pipeline -- for selling Prova itself, not a tenant's
 * GC/vendor relationships (that's /contacts). Gated on two independent
 * things, neither expressible as a lib/permissions.ts Capability: this
 * Company must be Prova's own operator (Company.isProvaOperator), and this
 * person must be its OWNER. A non-operator company sees nothing distinct
 * from any other page it hasn't been given a link to -- middleware still
 * requires sign-in, but nothing here names what the page would have shown.
 */
export default async function SalesPage() {
  const { company, ...currentUser } = await requireCompanyContext();

  if (!company.isProvaOperator) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-2 text-xl font-semibold text-slate-100">Not part of your access</h1>
        <p className="text-sm text-slate-400">Nothing here for this account.</p>
      </div>
    );
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

  const leads = await prisma.salesLead.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { opportunities: true } },
      activities: {
        select: { id: true, type: true, occurredOn: true, followUpOn: true, createdAt: true },
      },
      opportunities: {
        select: {
          id: true,
          stage: true,
          estimatedMrr: true,
          expectedCloseDate: true,
          stageChanges: {
            select: { id: true, fromStage: true, toStage: true, effectiveOn: true, note: true, recordedAt: true },
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
      const changes: RecordedStageChange[] = opportunity.stageChanges.map((change) => ({
        id: change.id,
        fromStage: change.fromStage,
        toStage: change.toStage,
        effectiveOn: toIsoDate(change.effectiveOn) as string,
        note: change.note,
        recordedAt: change.recordedAt.toISOString(),
      }));

      return {
        id: opportunity.id,
        leadId: lead.id,
        companyName: lead.companyName,
        stage: opportunity.stage,
        // Decimal | null -> number | null. Never ?? 0: an unpriced deal is
        // not a deal worth nothing, and every total downstream depends on
        // the difference.
        estimatedMrr: opportunity.estimatedMrr === null ? null : Number(opportunity.estimatedMrr),
        expectedCloseDate: toIsoDate(opportunity.expectedCloseDate),
        daysInStage: daysInCurrentStage(changes, today),
      };
    }),
  );

  const pipeline = buildSalesPipeline(pipelineOpportunities, today);
  const sittingLongest = longestOpen(pipelineOpportunities, 3);

  const queue = followUpQueue(activitySources, today);
  const overdueCount = countOverdue(queue);
  const summaries = new Map(
    activitySources.map((source) => [source.leadId, summarizeLeadActivity(source, today)]),
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-1 text-lg font-semibold text-slate-100">Sales CRM</h1>
      <p className="mb-6 text-sm text-slate-400">
        Prospective Prova customers and the deals in progress with them -- internal, not visible to
        any tenant.
      </p>

      <SalesPipelineBand pipeline={pipeline} sittingLongest={sittingLongest} />

      {queue.length > 0 && (
        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-100">
            {queue.length} {queue.length === 1 ? "lead owes" : "leads owe"} a follow-up
            {overdueCount > 0 && <span className="text-red-400"> — {overdueCount} overdue</span>}
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Read from each lead&apos;s most recent activity. Logging the next one with the follow-up
            date left blank is what takes a lead off this list.
          </p>
          <ul className="divide-y divide-slate-800">
            {queue.map((row) => (
              <li key={row.leadId} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/sales/${row.leadId}`} className="text-sm text-slate-200 hover:underline">
                  {row.companyName}
                </Link>
                <span
                  className={`text-xs ${
                    row.followUpStanding === "OVERDUE"
                      ? "text-red-400"
                      : row.followUpStanding === "DUE_TODAY"
                        ? "text-amber-300"
                        : "text-slate-500"
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

      {leads.length === 0 ? (
        <p className="mb-4 text-sm text-slate-400">No leads recorded yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {leads.map((lead) => (
            <SalesLeadRow
              key={lead.id}
              lead={{
                id: lead.id,
                companyName: lead.companyName,
                contactName: lead.contactName,
                email: lead.email,
                phone: lead.phone,
                source: lead.source,
                opportunityCount: lead._count.opportunities,
                lastContactOn: summaries.get(lead.id)?.lastContactOn ?? null,
                daysSinceContact: summaries.get(lead.id)?.daysSinceContact ?? null,
                followUpOn: summaries.get(lead.id)?.followUpOn ?? null,
                followUpStanding: summaries.get(lead.id)?.followUpStanding ?? null,
              }}
            />
          ))}
        </ul>
      )}

      <SalesLeadForm />
    </div>
  );
}
