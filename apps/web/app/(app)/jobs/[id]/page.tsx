import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { PrintButton } from "@/components/PrintButton";
import { PrevailingWageDeterminationForm } from "@/components/PrevailingWageDeterminationForm";
import { ContractSummary } from "@/components/ContractSummary";
import { WipNarrativeButton } from "@/components/WipNarrativeButton";
import { DraftLineItemsForm } from "@/components/DraftLineItemsForm";
import { TakeoffForm } from "@/components/TakeoffForm";
import { DailyFieldReports } from "@/components/DailyFieldReports";
import { PayApplications, StatusForm } from "@/components/PayApplications";
import { PushPaymentToQuickBooks } from "@/components/PushPaymentToQuickBooks";
import { PushInvoiceToQuickBooks } from "@/components/PushInvoiceToQuickBooks";
import { pushBlockers } from "@/lib/quickbooks-sync";
import { paymentPushBlockers } from "@/lib/quickbooks-payment-sync";
import { accountPurpose } from "@/lib/quickbooks-constants";
import { MarkContractedButton } from "@/components/MarkContractedButton";
import { ChangeOrders, type ChangeOrderView } from "@/components/ChangeOrders";
import { changeOrderValueDelta, pendingChangeOrderExposure, reopenBlockers } from "@/lib/change-order";
import { can } from "@/lib/permissions";
import { money } from "@/lib/money";
import { calculateLineItemWip, calculateJobWip } from "@/lib/wip";
import { calculateTimeEntryLaborCost, findEffectiveFringeRateSchedule } from "@/lib/labor-cost";
import { burdenedHourlyRate, estimateBurdenedLaborCost, laborRateDateFor } from "@/lib/estimate-labor-cost";
import { LaborHoursField } from "@/components/LaborHoursField";
import { calculateRetainageSummary } from "@/lib/retainage";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addCostEntry,
  addLineItem,
  addLineItemFromCatalog,
  assignCrewMember,
  createInvoice,
  createSignatureRequest,
  deleteCostEntry,
  createRetainageRelease,
  deleteDispatchSlip,
  deleteLineItem,
  deletePayment,
  deletePrevailingWageDetermination,
  deleteRetainageRelease,
  deleteTimeEntry,
  logPayment,
  logTimeEntry,
  updateJobRetainageTerms,
  uploadDispatchSlip,
  markJobContracted,
  deleteContractDocument,
  saveEstimateVersion,
  saveLineItemAsCatalogEntry,
  unassignCrewMember,
  updateJobSchedule,
  updateLineItem,
  updateLineItemForecast,
  uploadContractDocument,
} from "@/lib/actions";

const COST_CATEGORIES = ["LABOR", "MATERIAL", "SUBCONTRACTOR", "OTHER"] as const;
const TIME_ENTRY_PAY_TYPE_OPTIONS = [
  { value: "STRAIGHT", label: "Straight" },
  { value: "OVERTIME", label: "Overtime" },
  { value: "DOUBLE_TIME", label: "Double time" },
  { value: "SHIFT_DIFFERENTIAL", label: "Shift differential" },
] as const;
const TRADE_SCOPE_OPTIONS = [
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

function dateInputValue(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

/**
 * How much to trust a drafted price.
 *
 * One "AI-drafted — verify" pill for every machine-produced row said only
 * that a machine made it, which is the flaw the market research names as
 * fatal in every competitor's auto-pricing: a well-grounded number and an
 * invented one look identical. After grounding the draft in this company's
 * own catalog and won bids, a price can come from three places that deserve
 * very different confidence, so they get three visibly different badges.
 */
function PriceBasisBadge({ basis }: { basis: "COMPANY_CATALOG" | "HISTORICAL_BID" | "GENERAL_KNOWLEDGE" | null }) {
  if (basis === "COMPANY_CATALOG") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
        Your catalog price
      </span>
    );
  }
  if (basis === "HISTORICAL_BID") {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300">
        From your past bids — verify
      </span>
    );
  }
  if (basis === "GENERAL_KNOWLEDGE") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
        AI guess, no company data — check the price
      </span>
    );
  }
  // Drafted, but no price was suggested. Nothing to be confident or unsure
  // about; the row still needs reviewing as a drafted row.
  return (
    <span className="inline-flex items-center rounded-full bg-slate-700/40 px-2 py-0.5 text-xs font-medium text-slate-300">
      AI-drafted, unpriced — verify
    </span>
  );
}

/**
 * "≈ $X labor" beside the hours field. Read-only and informational — never
 * written into budgetedUnitCost, which stays the estimator's own number, the
 * same philosophy as the estimatedCostToComplete PM override.
 */
function LaborCostHint({ cost }: { cost: number | null }) {
  if (cost === null) return null;
  return (
    <span className="text-xs text-slate-400" title="Burdened labor: base wage plus fringes, at straight time">
      ≈ {money(cost)} labor
    </span>
  );
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { company, ...currentUser } = await requireCompanyContext();

  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      contact: true,
      lineItems: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        include: {
          originChangeOrder: true,
          costEntries: { orderBy: { incurredAt: "desc" } },
          craftClassification: { include: { unionLocal: true } },
        },
      },
      estimateVersions: {
        orderBy: { versionNumber: "desc" },
        include: { createdByUser: true },
      },
      contractDocuments: {
        orderBy: { versionNumber: "desc" },
        include: { uploadedByUser: true },
      },
      changeOrders: {
        orderBy: { number: "asc" },
        include: {
          edits: true,
          proposals: { orderBy: { createdAt: "asc" } },
          supersedes: { select: { number: true } },
          revisions: { select: { number: true }, orderBy: { number: "asc" } },
        },
      },
      dailyFieldReports: {
        orderBy: { reportDate: "desc" },
        include: { filedBy: true },
      },
      assignments: {
        include: { user: true },
        orderBy: { createdAt: "asc" },
      },
      signatureRequests: {
        orderBy: { createdAt: "desc" },
      },
      invoices: {
        orderBy: { number: "asc" },
        include: { payments: { orderBy: { receivedAt: "desc" } }, lineItems: true },
      },
      timeEntries: {
        orderBy: { date: "desc" },
        include: {
          employeeUser: true,
          lineItem: true,
          craftClassification: { include: { unionLocal: true } },
        },
      },
      dispatchSlips: {
        orderBy: { dispatchDate: "desc" },
        include: {
          employeeUser: true,
          craftClassification: { include: { unionLocal: true } },
        },
      },
      prevailingWageDeterminations: {
        orderBy: { createdAt: "desc" },
        include: { uploadedByUser: true },
      },
      retainageReleases: {
        orderBy: { releasedAt: "desc" },
      },
      operatingLocation: true,
    },
  });

  if (!job || job.companyId !== company.id) {
    notFound();
  }

  const [companyMembers, companyLocations, catalogEntries, craftClassifications] = await Promise.all([
    prisma.user.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.companyLocation.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.lineItemCatalogEntry.findMany({ where: { companyId: company.id }, orderBy: { description: "asc" } }),
    prisma.craftClassification.findMany({
      where: { unionLocal: { companyAgreements: { some: { companyId: company.id } } } },
      include: { unionLocal: true, fringeRateSchedules: true },
      orderBy: { name: "asc" },
    }),
  ]);
  // Burdened labor cost per line at bid time. The hours and the craft have
  // been captured since the estimate was built and the burden math has
  // existed all along for logged time — it just never ran at bid time, which
  // is where the risk actually is: takeoff quantities in this trade are
  // ~97-98% accurate while projects still overrun ~28%, and the gap is crew
  // hours. Priced at the job's planned start where it has one, since union
  // rates step on scheduled dates.
  const laborRateDate = laborRateDateFor(job, new Date());
  const schedulesByCraft = new Map(
    craftClassifications.map((craft) => [
      craft.id,
      craft.fringeRateSchedules.map((schedule) => ({
        baseWage: Number(schedule.baseWage),
        pensionRate: schedule.pensionRate != null ? Number(schedule.pensionRate) : null,
        vacationRate: schedule.vacationRate != null ? Number(schedule.vacationRate) : null,
        healthWelfareRate:
          schedule.healthWelfareRate != null ? Number(schedule.healthWelfareRate) : null,
        trainingRate: schedule.trainingRate != null ? Number(schedule.trainingRate) : null,
        effectiveFrom: schedule.effectiveFrom,
        effectiveTo: schedule.effectiveTo,
      })),
    ]),
  );
  const craftOptions = craftClassifications.map((craft) => ({
    id: craft.id,
    label: `${craft.unionLocal.parentInternational} ${craft.unionLocal.localNumber} — ${craft.name}`,
    hourlyRate: burdenedHourlyRate(schedulesByCraft.get(craft.id) ?? [], laborRateDate),
  }));

  const estimatedLaborCostByLineItem = new Map(
    job.lineItems.map((item) => [
      item.id,
      estimateBurdenedLaborCost(
        item.laborHours != null ? Number(item.laborHours) : null,
        item.craftClassificationId ? (schedulesByCraft.get(item.craftClassificationId) ?? []) : [],
        laborRateDate,
      ),
    ]),
  );

  const assignedUserIds = new Set(job.assignments.map((a) => a.userId));
  const unassignedMembers = companyMembers.filter((m) => !assignedUserIds.has(m.id));

  const isEstimateStage = job.status === "ESTIMATE";

  // Percentage-of-completion WIP, cost-to-cost method — see lib/wip.ts.
  // jobWip.contractValue / jobWip.actualCostToDate are the single source of
  // truth for "total estimated" / "total actual" below — no separate
  // duplicate computation.
  const lineItemWip = job.lineItems.map((item) => ({
    item,
    wip: calculateLineItemWip({
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      budgetedUnitCost: item.budgetedUnitCost != null ? Number(item.budgetedUnitCost) : null,
      currentEstimatedUnitCost:
        item.currentEstimatedUnitCost != null ? Number(item.currentEstimatedUnitCost) : null,
      estimatedCostToComplete:
        item.estimatedCostToComplete != null ? Number(item.estimatedCostToComplete) : null,
      actualCostToDate: item.costEntries.reduce((s, entry) => s + Number(entry.amount), 0),
    }),
  }));
  // Burdened labor cost per time entry, using the FringeRateSchedule
  // effective on that entry's craft/date. Null (shown as "—") when the
  // entry has no craft tag or no schedule covers its date — see
  // lib/labor-cost.ts for why this never guesses a rate.
  const timeEntryLaborCosts = new Map(
    job.timeEntries.map((entry) => {
      const craft = craftClassifications.find((c) => c.id === entry.craftClassificationId);
      const schedule = craft
        ? findEffectiveFringeRateSchedule(
            craft.fringeRateSchedules.map((s) => ({
              baseWage: Number(s.baseWage),
              pensionRate: s.pensionRate != null ? Number(s.pensionRate) : null,
              vacationRate: s.vacationRate != null ? Number(s.vacationRate) : null,
              healthWelfareRate: s.healthWelfareRate != null ? Number(s.healthWelfareRate) : null,
              trainingRate: s.trainingRate != null ? Number(s.trainingRate) : null,
              effectiveFrom: s.effectiveFrom,
              effectiveTo: s.effectiveTo,
            })),
            entry.date,
          )
        : null;
      const cost = calculateTimeEntryLaborCost(
        { hours: Number(entry.hours), payType: entry.payType, date: entry.date },
        schedule,
      );
      return [entry.id, cost];
    }),
  );

  const retainageSummary = calculateRetainageSummary({
    invoiceRetainageWithheld: job.invoices.map((invoice) =>
      invoice.retainageWithheld != null ? Number(invoice.retainageWithheld) : null,
    ),
    releaseAmounts: job.retainageReleases.map((release) => Number(release.amount)),
    substantialCompletionDate: job.substantialCompletionDate,
  });

  // What would stop a push, worked out ONCE for the whole job and handed
  // to every row. The server has always refused a blocked push; until a
  // browser test caught it on 2026-09-03, nothing told the person WHY, so
  // "Send payment to QuickBooks" sat live and clickable on a payment whose
  // invoice QuickBooks had never seen.
  //
  // Read through the same helpers the actions use — `pushBlockers` and
  // `paymentPushBlockers` — rather than re-deriving the conditions here. A
  // second opinion about whether something is sendable is how a button and
  // the action behind it come to disagree.
  const [quickBooksConnection, jobCustomerLink, incomeAccountMapping] = await Promise.all([
    prisma.quickBooksConnection.findUnique({ where: { companyId: company.id } }),
    prisma.quickBooksEntityLink.findUnique({
      where: {
        companyId_entityType_entityId: {
          companyId: company.id,
          entityType: "Contact",
          entityId: job.contactId,
        },
      },
      select: { qboId: true },
    }),
    prisma.quickBooksAccountMapping.findUnique({
      where: {
        companyId_purpose: { companyId: company.id, purpose: accountPurpose("INCOME") },
      },
      select: { qboAccountId: true },
    }),
  ]);

  // NEEDS_REAUTH is not connected for this purpose: the token is dead and
  // no push can succeed until somebody reconnects.
  const quickBooksUsable =
    quickBooksConnection !== null && quickBooksConnection.status !== "NEEDS_REAUTH";

  // Which invoices are already in QuickBooks, so a row can say so without
  // being asked — and so re-sending is visibly a re-send rather than a
  // second document.
  const quickBooksInvoiceLinks = new Map(
    (
      await prisma.quickBooksEntityLink.findMany({
        where: {
          companyId: company.id,
          entityType: "Invoice",
          entityId: { in: job.invoices.map((invoice) => invoice.id) },
        },
        select: { entityId: true, qboId: true, lastVerifiedAt: true },
      })
    ).map((link) => [
      link.entityId,
      {
        qboId: link.qboId,
        lastVerifiedAt: link.lastVerifiedAt
          ? link.lastVerifiedAt.toISOString().slice(0, 10)
          : null,
      },
    ]),
  );

  // The same for payments. Without it a payment row cannot say whether it
  // reached QuickBooks, and "Send" would look identical on a payment that
  // is already there — which is how a second document gets created.
  const quickBooksPaymentLinks = new Map(
    (
      await prisma.quickBooksEntityLink.findMany({
        where: {
          companyId: company.id,
          entityType: "Payment",
          entityId: {
            in: job.invoices.flatMap((invoice) => invoice.payments.map((p) => p.id)),
          },
        },
        select: { entityId: true, qboId: true, lastVerifiedAt: true },
      })
    ).map((link) => [
      link.entityId,
      {
        qboId: link.qboId,
        lastVerifiedAt: link.lastVerifiedAt
          ? link.lastVerifiedAt.toISOString().slice(0, 10)
          : null,
      },
    ]),
  );

  const billedToDate = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  const jobWip = calculateJobWip(
    lineItemWip.map((l) => l.wip),
    billedToDate,
  );

  // Pay applications are just Invoices that carry a line-item breakdown —
  // see InvoiceLineItem in schema.prisma and lib/pay-application.ts.
  const payApplications = job.invoices
    .filter((invoice) => invoice.lineItems.length > 0)
    .map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      amount: Number(invoice.amount),
      issuedAt: invoice.issuedAt.toISOString(),
    }));
  const payApplicationLineItemOptions = job.lineItems.map((item) => ({
    id: item.id,
    description: item.description,
    scheduledValue: Number(item.quantity) * Number(item.unitPrice ?? 0),
  }));

  const addLineItemWithId = addLineItem.bind(null, job.id);
  const addLineItemFromCatalogWithId = addLineItemFromCatalog.bind(null, job.id);
  const saveEstimateVersionWithId = saveEstimateVersion.bind(null, job.id);
  const uploadContractDocumentWithId = uploadContractDocument.bind(null, job.id);
  // Change orders. A proposal's value is derived from the line item it
  // targets, so EDIT/REMOVE need the current row -- including ones an
  // earlier change order soft-deleted, which is why this map is built from
  // an unfiltered read rather than job.lineItems.
  const changeOrderTargetRows = await prisma.jobLineItem.findMany({
    where: { jobId: job.id },
    select: { id: true, description: true, quantity: true, unitPrice: true, isDeleted: true },
  });
  const changeOrderTargetsById = new Map(changeOrderTargetRows.map((item) => [item.id, item]));
  const changeOrderTargets = changeOrderTargetRows
    .filter((item) => !item.isDeleted)
    .map((item) => ({ id: item.id, description: item.description }));

  const describeProposal = (proposal: (typeof job.changeOrders)[number]["proposals"][number]) => {
    const target = proposal.lineItemId ? changeOrderTargetsById.get(proposal.lineItemId) : null;
    if (proposal.changeType === "ADD") {
      const price = proposal.unitPrice ? ` @ ${money(Number(proposal.unitPrice))}` : "";
      return `${proposal.description ?? "New scope"} — ${proposal.quantity ?? 1}${proposal.unit ? ` ${proposal.unit}` : ""}${price}`;
    }
    if (proposal.changeType === "REMOVE") {
      return target?.description ?? "(line item)";
    }
    const parts: string[] = [];
    if (proposal.quantity !== null) parts.push(`qty → ${proposal.quantity}`);
    if (proposal.unitPrice !== null) parts.push(`price → ${money(Number(proposal.unitPrice))}`);
    return `${target?.description ?? "(line item)"}: ${parts.join(", ")}`;
  };

  // Why an approved change order can't be reopened is worked out here rather
  // than on click, so the UI can say so before the user tries. Only approved
  // ones can be reopened at all, so nothing else is queried.
  const reopenBlockersByCO = new Map(
    await Promise.all(
      job.changeOrders
        .filter((co) => co.status === "APPROVED")
        .map(async (co) => [co.id, await reopenBlockers(co)] as const),
    ),
  );

  const changeOrderViews: ChangeOrderView[] = job.changeOrders.map((co) => ({
    id: co.id,
    number: co.number,
    title: co.title,
    description: co.description,
    status: co.status,
    submittedOn: co.submittedOn?.toISOString() ?? null,
    decidedOn: co.decidedOn?.toISOString() ?? null,
    decisionNotes: co.decisionNotes,
    reopenBlockers: reopenBlockersByCO.get(co.id) ?? [],
    reopenedAt: co.reopenedAt?.toISOString() ?? null,
    reopenNote: co.reopenNote,
    supersedesLabel: co.supersedes ? `CO #${co.supersedes.number}` : null,
    revisedByLabels: co.revisions.map((revision) => `CO #${revision.number}`),
    valueDelta: (() => {
      const delta = Number(changeOrderValueDelta(co.proposals, changeOrderTargetsById));
      return `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))}`;
    })(),
    proposals: co.proposals.map((proposal) => ({
      id: proposal.id,
      changeType: proposal.changeType,
      targetDescription: proposal.lineItemId
        ? changeOrderTargetsById.get(proposal.lineItemId)?.description ?? null
        : null,
      summary: describeProposal(proposal),
    })),
    edits: co.edits.map((edit) => ({
      id: edit.id,
      field: edit.field,
      oldValue: edit.oldValue,
      newValue: edit.newValue,
    })),
  }));

  const pendingExposure = Number(
    pendingChangeOrderExposure(job.changeOrders, changeOrderTargetsById),
  );

  const updateLineItemWithId = (lineItemId: string) => updateLineItem.bind(null, job.id, lineItemId);
  const updateLineItemForecastWithId = (lineItemId: string) =>
    updateLineItemForecast.bind(null, job.id, lineItemId);
  const deleteLineItemWithId = (lineItemId: string) => deleteLineItem.bind(null, job.id, lineItemId);
  const markContractedWithId = markJobContracted.bind(null, job.id);
  const addCostEntryWithId = (lineItemId: string) => addCostEntry.bind(null, job.id, lineItemId);
  const deleteCostEntryWithId = (costEntryId: string) => deleteCostEntry.bind(null, job.id, costEntryId);
  const updateScheduleWithId = updateJobSchedule.bind(null, job.id);
  const assignCrewWithId = assignCrewMember.bind(null, job.id);
  const unassignCrewWithId = (userId: string) => unassignCrewMember.bind(null, job.id, userId);
  const createSignatureRequestWithId = createSignatureRequest.bind(null, job.id);
  const createInvoiceWithId = createInvoice.bind(null, job.id);
  const logTimeEntryWithId = logTimeEntry.bind(null, job.id);
  const deleteTimeEntryWithId = (timeEntryId: string) => deleteTimeEntry.bind(null, job.id, timeEntryId);
  const uploadDispatchSlipWithId = uploadDispatchSlip.bind(null, job.id);
  const deleteDispatchSlipWithId = (dispatchSlipId: string) => deleteDispatchSlip.bind(null, job.id, dispatchSlipId);
  const deletePrevailingWageDeterminationWithId = (determinationId: string) =>
    deletePrevailingWageDetermination.bind(null, job.id, determinationId);
  const updateJobRetainageTermsWithId = updateJobRetainageTerms.bind(null, job.id);
  const createRetainageReleaseWithId = createRetainageRelease.bind(null, job.id);
  const deleteRetainageReleaseWithId = (releaseId: string) => deleteRetainageRelease.bind(null, job.id, releaseId);

  // What this person's job function lets them see of the job's money.
  // Computed once rather than per section, so the contract summary, the
  // WIP table and the change-order log cannot end up disagreeing about
  // whether this reader may see a price.
  //
  // Both are TRUE for an owner and for a member with no job function set,
  // so this page renders exactly as it always has for everyone who has
  // ever used it. Only a narrowed function loses anything.
  const principal = { role: currentUser.role, jobFunction: currentUser.jobFunction };
  const showsJobMoney = can(principal, "VIEW_JOB_COSTS");
  const showsBilling = can(principal, "MANAGE_BILLING");

  const headerList = await headers();
  const origin = `${headerList.get("x-forwarded-proto") ?? "https"}://${headerList.get("host")}`;
  const pendingSignature = job.signatureRequests.find((r) => r.status === "PENDING");
  const signedSignature = job.signatureRequests.find((r) => r.status === "SIGNED");

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
      {/* Contract-style summary — the same JobLineItem rows used as the
          estimate are rendered here as contract content, via the shared
          ContractSummary component also used by the public /esign/[token]
          signing page. Nothing below this heading is retyped anywhere. */}
      {showsJobMoney && (
      <div className="mb-10">
        <ContractSummary
          companyName={company.name}
          jobName={job.name}
          status={job.status}
          clientName={job.contact.name}
          scope={job.scope}
          lineItems={job.lineItems.map((item) => ({
            id: item.id,
            description: item.description,
            quantity: item.quantity.toString(),
            unit: item.unit,
            unitPrice: item.unitPrice?.toString() ?? null,
            changeOrderNumber: item.originChangeOrder?.number ?? null,
          }))}
          footer={<PrintButton />}
        />
      </div>
      )}

      <div className="print:hidden">
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Schedule</h2>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <form action={updateScheduleWithId} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Start date
                <input
                  type="date"
                  name="startDate"
                  defaultValue={dateInputValue(job.startDate)}
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                End date
                <input
                  type="date"
                  name="endDate"
                  defaultValue={dateInputValue(job.endDate)}
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Operating location
                <select
                  name="operatingLocationId"
                  defaultValue={job.operatingLocationId ?? ""}
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Unassigned</option>
                  {companyLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name ?? `${location.city}, ${location.state}`}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton
                type="submit"
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
              >
                Save dates
              </SubmitButton>
            </form>

            <div className="mt-4 border-t border-slate-800 pt-4">
              <p className="mb-2 text-sm font-medium text-slate-300">Crew</p>
              {job.assignments.length === 0 ? (
                <p className="text-sm text-slate-500">No one assigned yet.</p>
              ) : (
                <ul className="mb-3 flex flex-col gap-1">
                  {job.assignments.map((assignment) => (
                    <li key={assignment.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-100">
                        {assignment.user.name ?? assignment.user.email}
                      </span>
                      <form action={unassignCrewWithId(assignment.userId)}>
                        <SubmitButton type="submit" className="text-xs text-red-400 hover:underline">
                          Remove
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              {unassignedMembers.length > 0 && (
                <form action={assignCrewWithId} className="flex items-end gap-2">
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Assign teammate
                    <select
                      name="userId"
                      required
                      className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    >
                      {unassignedMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name ?? member.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <SubmitButton
                    type="submit"
                    className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
                  >
                    Assign
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>
        </section>

        {/* The signing link renders the priced contract. */}
        {showsJobMoney && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Contract signature</h2>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            {signedSignature ? (
              <p className="text-sm text-green-400">
                Signed by {signedSignature.signerName} on{" "}
                {signedSignature.signedAt?.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                .
              </p>
            ) : pendingSignature ? (
              <div className="text-sm">
                <p className="mb-2 text-slate-300">
                  Waiting on the client to sign. Share this link with them:
                </p>
                <p className="break-all rounded-md bg-slate-950 px-3 py-2 font-mono text-xs text-blue-400">
                  {origin}/esign/{pendingSignature.token}
                </p>
              </div>
            ) : (
              <div>
                <p className="mb-3 text-sm text-slate-400">
                  No signing link yet. Once the client signs, this job can be marked as contracted.
                </p>
                <form action={createSignatureRequestWithId}>
                  <SubmitButton
                    type="submit"
                    className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
                  >
                    Create signing link
                  </SubmitButton>
                </form>
              </div>
            )}
          </div>
        </section>
        )}

        {/* The subcontract PDF states the contract value. */}
        {showsJobMoney && (
        <section className="mb-10">
          <h2 className="mb-1 text-lg font-semibold text-slate-100">Subcontract agreement</h2>
          <p className="mb-3 text-sm text-slate-400">
            The actual GC-to-sub contract file — separate from the e-sign snapshot above. Upload the
            original agreement, then any amendment the GC sends later as a new version; nothing is
            overwritten.
          </p>
          {job.contractDocuments.length > 0 && (
            <ul className="mb-4 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
              {job.contractDocuments.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium text-slate-100">
                      v{doc.versionNumber}
                      {doc.versionNumber === 1 ? " (original)" : " (amendment)"}
                    </p>
                    <p className="text-sm text-slate-400">
                      {doc.createdAt.toLocaleDateString()}
                      {doc.uploadedByUser?.name || doc.uploadedByUser?.email
                        ? ` · ${doc.uploadedByUser.name ?? doc.uploadedByUser.email}`
                        : ""}
                    </p>
                    {doc.note && <p className="text-sm text-slate-500">{doc.note}</p>}
                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs text-blue-400 hover:underline"
                    >
                      {doc.fileName}
                    </a>
                  </div>
                  {currentUser.role === "OWNER" && (
                    <form action={deleteContractDocument.bind(null, doc.id)}>
                      <SubmitButton type="submit" className="text-xs text-red-400 hover:underline">
                        Delete
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            action={uploadContractDocumentWithId}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
          >
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              {job.contractDocuments.length === 0 ? "Upload the agreement" : "Upload an amendment"}
              <input
                type="file"
                name="file"
                required
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                className="text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-700"
              />
            </label>
            <label className="flex flex-1 min-w-[180px] flex-col gap-1 text-sm text-slate-300">
              Note (optional)
              <input
                name="note"
                placeholder={job.contractDocuments.length === 0 ? "" : "e.g. Amendment #1: added scope"}
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <SubmitButton
              type="submit"
              className="inline-flex items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
            >
              Upload
            </SubmitButton>
          </form>
        </section>
        )}

        {/* Actual cost, forecast and margin. The whole section, not a
            filtered version of it: a WIP table with the money taken out is
            still a WIP table, and half a screen of blanks reads as broken. */}
        {showsJobMoney && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-slate-100">Job costing &amp; WIP</h2>

          <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Contract value</p>
              <p className="text-slate-100">{money(jobWip.contractValue)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Actual cost to date</p>
              <p className="text-slate-100">{money(jobWip.actualCostToDate)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">% complete</p>
              <p className="text-slate-100">
                {jobWip.percentComplete != null ? `${(jobWip.percentComplete * 100).toFixed(1)}%` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Earned revenue</p>
              <p className="text-slate-100">{money(jobWip.earnedRevenue)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Billed to date</p>
              <p className="text-slate-100">{money(jobWip.billedToDate)}</p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-xs text-slate-500">Over / under billed</p>
              <p className={jobWip.overUnderBilling > 0 ? "text-amber-400" : "text-green-400"}>
                {jobWip.overUnderBilling > 0
                  ? `Overbilled ${money(jobWip.overUnderBilling)}`
                  : jobWip.overUnderBilling < 0
                    ? `Underbilled ${money(Math.abs(jobWip.overUnderBilling))}`
                    : "Even"}
              </p>
            </div>
          </div>

          <WipNarrativeButton jobId={job.id} />

          <div className="mt-6 flex flex-col gap-4">
            {lineItemWip.map(({ item, wip }) => {
              const tradeLabel = TRADE_SCOPE_OPTIONS.find((t) => t.value === item.tradeScope)?.label;
              return (
                <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-slate-100">
                      {item.description}
                      {tradeLabel && (
                        <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                          {tradeLabel}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span className="text-slate-400">Contract {money(wip.contractValue)}</span>
                    <span className="text-slate-400">
                      Budget {wip.budgetedCost != null ? money(wip.budgetedCost) : "—"}
                    </span>
                    <span className="text-slate-400">
                      Current est. {wip.currentEstimatedCost != null ? money(wip.currentEstimatedCost) : "—"}
                    </span>
                    <span className="text-slate-400">Actual {money(wip.actualCostToDate)}</span>
                    <span className="text-slate-400">
                      % complete {wip.percentComplete != null ? `${(wip.percentComplete * 100).toFixed(1)}%` : "—"}
                    </span>
                    <span className="text-slate-400">
                      Earned {wip.earnedRevenue != null ? money(wip.earnedRevenue) : "—"}
                    </span>
                  </div>

                  {item.costEntries.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1 border-t border-slate-800 pt-3">
                      {item.costEntries.map((entry) => (
                        <li key={entry.id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-300">
                            {entry.description}{" "}
                            <span className="text-xs text-slate-500">({entry.category})</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-slate-100">{money(Number(entry.amount))}</span>
                            <form action={deleteCostEntryWithId(entry.id)}>
                              <SubmitButton
                                type="submit"
                                title="Remove"
                                className="text-xs text-red-400 hover:underline"
                              >
                                Remove
                              </SubmitButton>
                            </form>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <form
                    action={addCostEntryWithId(item.id)}
                    className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3"
                  >
                    <input
                      name="description"
                      placeholder="Cost description"
                      required
                      className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                    <input
                      name="amount"
                      placeholder="Amount"
                      required
                      className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                    <select
                      name="category"
                      defaultValue="OTHER"
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                    >
                      {COST_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <select
                      name="tradeScope"
                      defaultValue={item.tradeScope ?? ""}
                      title="Trade this expense belongs to — defaults to this line item's trade, but can differ (e.g. a general-conditions line spanning several trades)"
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">No trade tag</option>
                      {TRADE_SCOPE_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <SubmitButton
                      type="submit"
                      className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
                    >
                      Log cost
                    </SubmitButton>
                  </form>

                  <form
                    action={updateLineItemForecastWithId(item.id)}
                    className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3"
                  >
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      Re-forecast current unit cost
                      <input
                        name="currentEstimatedUnitCost"
                        defaultValue={item.currentEstimatedUnitCost?.toString() ?? ""}
                        placeholder="per unit"
                        className="w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-400">
                      Override cost-to-complete
                      <input
                        name="estimatedCostToComplete"
                        defaultValue={item.estimatedCostToComplete?.toString() ?? ""}
                        placeholder="leave blank to auto-derive"
                        title="Overrides the mechanical (current estimate - actual) calculation — use when you know something the cost data doesn't reflect yet"
                        className="w-44 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                    <SubmitButton
                      type="submit"
                      className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
                    >
                      Save forecast
                    </SubmitButton>
                  </form>
                </div>
              );
            })}
          </div>
        </section>
        )}

        <section className="mb-10">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-100">Field time entries</h2>
            <Link href={`/jobs/${job.id}/certified-payroll`} className="text-sm text-blue-400 hover:underline">
              Certified payroll report →
            </Link>
          </div>
          <p className="mb-3 text-sm text-slate-500">
            Hours worked by employee, by day — optionally tied to a cost code and craft classification.
            Tracks hours by pay type; wage cost is estimated from the applicable fringe rate schedule when one
            applies.
          </p>

          {job.timeEntries.length > 0 && (
            <ul className="mb-4 flex flex-col gap-2">
              {job.timeEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-slate-100">
                      {entry.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <span className="text-slate-300">{entry.employeeUser.name ?? entry.employeeUser.email}</span>
                    <span className="text-slate-400">{Number(entry.hours)}h</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                      {TIME_ENTRY_PAY_TYPE_OPTIONS.find((p) => p.value === entry.payType)?.label ?? entry.payType}
                    </span>
                    {entry.craftClassification && (
                      <span className="text-xs text-slate-500">{entry.craftClassification.name}</span>
                    )}
                    {entry.lineItem && <span className="text-xs text-slate-500">{entry.lineItem.description}</span>}
                    {timeEntryLaborCosts.get(entry.id) != null && (
                      <span className="text-xs text-slate-500">
                        Est. cost {money(timeEntryLaborCosts.get(entry.id)!)}
                      </span>
                    )}
                    {entry.perDiemAmount != null && (
                      <span className="text-xs text-slate-500">Per diem {money(Number(entry.perDiemAmount))}</span>
                    )}
                    {entry.travelPayAmount != null && (
                      <span className="text-xs text-slate-500">Travel {money(Number(entry.travelPayAmount))}</span>
                    )}
                    {entry.note && <span className="text-xs text-slate-500">— {entry.note}</span>}
                  </div>
                  <form action={deleteTimeEntryWithId(entry.id)}>
                    <SubmitButton type="submit" title="Remove" className="text-xs text-red-400 hover:underline">
                      Remove
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={logTimeEntryWithId} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Employee
              <select
                name="employeeUserId"
                required
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                {companyMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name ?? member.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Date
              <input
                type="date"
                name="date"
                required
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Hours
              <input
                name="hours"
                placeholder="8"
                required
                className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Pay type
              <select
                name="payType"
                defaultValue="STRAIGHT"
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                {TIME_ENTRY_PAY_TYPE_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Cost code / SOV line
              <select
                name="lineItemId"
                defaultValue=""
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="">No specific line</option>
                {job.lineItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Craft classification
              <select
                name="craftClassificationId"
                defaultValue=""
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="">No craft tag</option>
                {craftClassifications.map((craft) => (
                  <option key={craft.id} value={craft.id}>
                    {craft.unionLocal.parentInternational} {craft.unionLocal.localNumber} — {craft.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Per diem
              <input
                name="perDiemAmount"
                placeholder="optional"
                className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Travel pay
              <input
                name="travelPayAmount"
                placeholder="optional"
                className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <input
              name="note"
              placeholder="Note (optional)"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <SubmitButton
              type="submit"
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
            >
              Log time
            </SubmitButton>
          </form>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-lg font-semibold text-slate-100">Union hiring-hall dispatch</h2>
          <p className="mb-3 text-sm text-slate-500">
            The hiring hall&rsquo;s referral of a worker to this job — the authorization to work under that
            local&rsquo;s agreement, separate from hours actually logged in Field time entries above.
          </p>

          {job.dispatchSlips.length > 0 && (
            <ul className="mb-4 flex flex-col gap-2">
              {job.dispatchSlips.map((slip) => (
                <li
                  key={slip.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-slate-100">
                      {slip.dispatchDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <span className="text-slate-300">{slip.employeeUser.name ?? slip.employeeUser.email}</span>
                    {slip.craftClassification && (
                      <span className="text-xs text-slate-500">{slip.craftClassification.name}</span>
                    )}
                    {slip.dispatchNumber && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                        #{slip.dispatchNumber}
                      </span>
                    )}
                    {slip.fileUrl && (
                      <a
                        href={slip.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-400 hover:underline"
                      >
                        {slip.fileName ?? "View slip"}
                      </a>
                    )}
                    {slip.note && <span className="text-xs text-slate-500">— {slip.note}</span>}
                  </div>
                  <form action={deleteDispatchSlipWithId(slip.id)}>
                    <SubmitButton type="submit" title="Remove" className="text-xs text-red-400 hover:underline">
                      Remove
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form
            action={uploadDispatchSlipWithId}
            encType="multipart/form-data"
            className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3"
          >
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Employee
              <select
                name="employeeUserId"
                required
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                {companyMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name ?? member.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Dispatch date
              <input
                type="date"
                name="dispatchDate"
                required
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Craft classification
              <select
                name="craftClassificationId"
                defaultValue=""
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="">No craft tag</option>
                {craftClassifications.map((craft) => (
                  <option key={craft.id} value={craft.id}>
                    {craft.unionLocal.parentInternational} {craft.unionLocal.localNumber} — {craft.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Dispatch #
              <input
                name="dispatchNumber"
                placeholder="optional"
                className="w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Slip (optional)
              <input
                type="file"
                name="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-slate-200 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <input
              name="note"
              placeholder="Note (optional)"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <SubmitButton
              type="submit"
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
            >
              Log dispatch
            </SubmitButton>
          </form>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-lg font-semibold text-slate-100">Prevailing wage determination</h2>
          <p className="mb-3 text-sm text-slate-500">
            The government wage determination for this job&rsquo;s jurisdiction (federal or state) — attach a copy
            or a link to it. This app doesn&rsquo;t look one up automatically; there&rsquo;s no licensed
            prevailing-wage dataset built in.
          </p>

          {job.prevailingWageDeterminations.length > 0 && (
            <ul className="mb-4 flex flex-col gap-2">
              {job.prevailingWageDeterminations.map((determination) => (
                <li
                  key={determination.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-slate-100">{determination.jurisdiction}</span>
                    {determination.fileUrl && (
                      <a
                        href={determination.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-400 hover:underline"
                      >
                        {determination.fileName ?? "View document"}
                      </a>
                    )}
                    {determination.sourceUrl && (
                      <a
                        href={determination.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-400 hover:underline"
                      >
                        Source link
                      </a>
                    )}
                    {determination.note && <span className="text-xs text-slate-500">— {determination.note}</span>}
                  </div>
                  <form action={deletePrevailingWageDeterminationWithId(determination.id)}>
                    <SubmitButton type="submit" title="Remove" className="text-xs text-red-400 hover:underline">
                      Remove
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <PrevailingWageDeterminationForm jobId={job.id} />
        </section>

        {!isEstimateStage && showsBilling && (
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold text-slate-100">Invoices</h2>
            <div className="flex flex-col gap-4">
              {job.invoices.map((invoice) => {
                const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
                const balance = Number(invoice.amount) - paid;
                const logPaymentWithIds = logPayment.bind(null, job.id, invoice.id);
                return (
                  <div key={invoice.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-slate-100">
                        Invoice #{invoice.number}
                        {invoice.description ? ` — ${invoice.description}` : ""}
                      </p>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-slate-400">Amount {money(Number(invoice.amount))}</span>
                        <span className="text-slate-400">Paid {money(paid)}</span>
                        <span className={balance <= 0 ? "text-green-400" : "text-amber-400"}>
                          {balance <= 0 ? "Paid in full" : `Balance ${money(balance)}`}
                        </span>
                        <StatusForm jobId={job.id} invoiceId={invoice.id} status={invoice.status} />
                        <PushInvoiceToQuickBooks
                          invoiceId={invoice.id}
                          linkedQboId={quickBooksInvoiceLinks.get(invoice.id)?.qboId ?? null}
                          lastVerifiedAt={
                            quickBooksInvoiceLinks.get(invoice.id)?.lastVerifiedAt ?? null
                          }
                          blockers={pushBlockers({
                            hasConnection: quickBooksUsable,
                            customerQboId: jobCustomerLink?.qboId ?? null,
                            incomeAccountId: incomeAccountMapping?.qboAccountId ?? null,
                            totalCents: Math.round(Number(invoice.amount) * 100),
                          })}
                        />
                      </div>
                    </div>
                    {invoice.lineItems.length > 0 && (
                      <Link
                        href={`/jobs/${job.id}/pay-applications/${invoice.id}`}
                        className="mt-1 inline-block text-xs text-blue-400 hover:underline"
                      >
                        View pay application →
                      </Link>
                    )}
                    {invoice.dueAt && (
                      <p className="mt-1 text-xs text-slate-500">
                        Due {invoice.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    )}
                    {invoice.retainageWithheld != null && (
                      <p className="mt-1 text-xs text-slate-500">
                        Retainage withheld this invoice: {money(Number(invoice.retainageWithheld))}
                      </p>
                    )}

                    {invoice.payments.length > 0 && (
                      <ul className="mt-3 flex flex-col gap-1 border-t border-slate-800 pt-3">
                        {invoice.payments.map((payment) => (
                          <li key={payment.id} className="flex items-center justify-between text-sm">
                            <span className="text-slate-300">
                              {payment.receivedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              {payment.method ? ` · ${payment.method}` : ""}
                              {payment.note ? ` · ${payment.note}` : ""}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="text-slate-100">{money(Number(payment.amount))}</span>
                              <PushPaymentToQuickBooks
                                paymentId={payment.id}
                                linkedQboId={quickBooksPaymentLinks.get(payment.id)?.qboId ?? null}
                                lastVerifiedAt={
                                  quickBooksPaymentLinks.get(payment.id)?.lastVerifiedAt ?? null
                                }
                                blockers={paymentPushBlockers({
                                  hasConnection: quickBooksUsable,
                                  customerQboId: jobCustomerLink?.qboId ?? null,
                                  // The ordering constraint, and the one the
                                  // browser test found unguarded: a payment is
                                  // APPLIED to an invoice, so the invoice has to
                                  // be there first.
                                  invoiceQboId:
                                    quickBooksInvoiceLinks.get(invoice.id)?.qboId ?? null,
                                  amountCents: Math.round(Number(payment.amount) * 100),
                                })}
                              />
                              <form action={deletePayment.bind(null, job.id, payment.id)}>
                                <SubmitButton
                                  type="submit"
                                  title="Remove"
                                  className="text-xs text-red-400 hover:underline"
                                >
                                  Remove
                                </SubmitButton>
                              </form>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {balance > 0 && (
                      <form
                        action={logPaymentWithIds}
                        className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3"
                      >
                        <input
                          name="amount"
                          placeholder="Amount"
                          required
                          className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                        />
                        <input
                          name="method"
                          placeholder="Method (check, cash...)"
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                        />
                        <input
                          name="note"
                          placeholder="Note (optional)"
                          className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                        />
                        <SubmitButton
                          type="submit"
                          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
                        >
                          Log payment
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>

            <form
              action={createInvoiceWithId}
              className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
            >
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Description
                <input
                  name="description"
                  placeholder="Deposit, final payment, etc."
                  className="w-56 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Amount
                <input
                  name="amount"
                  required
                  className="w-28 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Due date
                <input
                  type="date"
                  name="dueAt"
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <SubmitButton
                type="submit"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Create invoice
              </SubmitButton>
            </form>
          </section>
        )}

        {!isEstimateStage && showsBilling && (
          <section className="mb-10">
            <h2 className="mb-1 text-lg font-semibold text-slate-100">Retainage</h2>
            <p className="mb-3 text-sm text-slate-500">
              Withheld amounts are snapshotted onto each invoice when it&rsquo;s created from the rate below —
              changing the rate only affects invoices created after the change.
            </p>

            <form
              action={updateJobRetainageTermsWithId}
              className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3"
            >
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Retainage %
                <input
                  name="retainagePercent"
                  defaultValue={job.retainagePercent?.toString() ?? job.contact.defaultRetainagePercent?.toString() ?? ""}
                  placeholder="e.g. 10"
                  className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Expected substantial completion
                <input
                  type="date"
                  name="substantialCompletionDate"
                  defaultValue={dateInputValue(job.substantialCompletionDate)}
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <SubmitButton
                type="submit"
                className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
              >
                Save
              </SubmitButton>
            </form>

            <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Total withheld</p>
                <p className="text-slate-100">{money(retainageSummary.totalWithheld)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Total released</p>
                <p className="text-slate-100">{money(retainageSummary.totalReleased)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Outstanding balance</p>
                <p className={retainageSummary.balance > 0 ? "text-amber-400" : "text-green-400"}>
                  {money(retainageSummary.balance)}
                </p>
              </div>
            </div>

            {retainageSummary.balance > 0 && retainageSummary.substantialCompletionDate && (
              <p className="mb-4 text-sm text-slate-400">
                Expected release: {money(retainageSummary.balance)} around{" "}
                {retainageSummary.substantialCompletionDate.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                (this job&rsquo;s expected substantial completion date) — a forecast based on the date set above, not
                a guarantee of when the GC will actually release it.
              </p>
            )}

            {job.retainageReleases.length > 0 && (
              <ul className="mb-4 flex flex-col gap-2">
                {job.retainageReleases.map((release) => (
                  <li
                    key={release.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-slate-100">
                        {release.releasedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      <span className="text-slate-300">{money(Number(release.amount))}</span>
                      {release.note && <span className="text-xs text-slate-500">— {release.note}</span>}
                    </div>
                    <form action={deleteRetainageReleaseWithId(release.id)}>
                      <SubmitButton type="submit" title="Remove" className="text-xs text-red-400 hover:underline">
                        Remove
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <form
              action={createRetainageReleaseWithId}
              className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3"
            >
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Amount released
                <input
                  name="amount"
                  placeholder="Amount"
                  required
                  className="w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Date
                <input
                  type="date"
                  name="releasedAt"
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <input
                name="note"
                placeholder="Note (optional)"
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <SubmitButton
                type="submit"
                className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-700"
              >
                Log release
              </SubmitButton>
            </form>
          </section>
        )}

        {/* Prices, change-order value deltas and estimate versions. Withheld
            from a job function without VIEW_JOB_COSTS — the field tier reads
            the schedule and files reports above without being handed the
            job's commercial terms. */}
        {!showsJobMoney ? null : isEstimateStage ? (
          <>
            <section className="mb-10">
              <h2 className="mb-3 text-lg font-semibold text-slate-100">Line items (estimate)</h2>
              <DraftLineItemsForm jobId={job.id} initialScope={job.scope ?? ""} />
              {/* Beside the scope drafter rather than below the list: both
                  answer "where do line items come from", and the two ways in
                  belong in the same place. Gated by the same
                  assertEditableDirectly, so it only appears where lines can
                  actually be added. */}
              <TakeoffForm jobId={job.id} />
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                {job.lineItems.length === 0 && (
                  <p className="py-2 text-sm text-slate-400">No line items yet — add one below.</p>
                )}
                {job.lineItems.map((item) => (
                  <div key={item.id} className="border-t border-slate-800 py-3 first:border-t-0">
                  <form
                    action={updateLineItemWithId(item.id)}
                    className="flex flex-col gap-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {item.aiDrafted && <PriceBasisBadge basis={item.priceBasis} />}
                      <input
                        name="description"
                        defaultValue={item.description}
                        required
                        placeholder="Description"
                        className="min-w-[160px] flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                      />
                      <input
                        name="quantity"
                        defaultValue={item.quantity.toString()}
                        required
                        title="Quantity"
                        className="w-16 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                      />
                      <input
                        name="unit"
                        defaultValue={item.unit ?? ""}
                        placeholder="Unit"
                        className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                      />
                      <select
                        name="tradeScope"
                        defaultValue={item.tradeScope ?? ""}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">No trade tag</option>
                        {TRADE_SCOPE_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        Unit price
                        <input
                          name="unitPrice"
                          defaultValue={item.unitPrice?.toString() ?? ""}
                          placeholder="cost-only"
                          title="Leave blank for a cost-only budget line (general conditions, overhead) with no client-facing price"
                          className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        Budgeted cost
                        <input
                          name="budgetedUnitCost"
                          defaultValue={item.budgetedUnitCost?.toString() ?? ""}
                          placeholder="per unit"
                          title="Estimated unit cost at estimate approval — the frozen historical baseline for WIP reporting"
                          className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-slate-400">
                        Labor hrs
                        <input
                          name="laborHours"
                          defaultValue={item.laborHours?.toString() ?? ""}
                          placeholder="hrs"
                          className="w-16 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                        />
                      </label>
                      <LaborCostHint cost={estimatedLaborCostByLineItem.get(item.id) ?? null} />
                      <select
                        name="craftClassificationId"
                        defaultValue={item.craftClassificationId ?? ""}
                        title="Craft classification"
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">No craft tag</option>
                        {craftClassifications.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.unionLocal.parentInternational} {c.unionLocal.localNumber} — {c.name}
                          </option>
                        ))}
                      </select>
                      <SubmitButton
                        type="submit"
                        title="Save"
                        className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-700"
                      >
                        Save
                      </SubmitButton>
                      <SubmitButton
                        type="submit"
                        formAction={deleteLineItemWithId(item.id)}
                        title="Remove"
                        className="rounded-md bg-red-950 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-900"
                      >
                        Remove
                      </SubmitButton>
                    </div>
                  </form>
                  <form action={saveLineItemAsCatalogEntry.bind(null, item.id)} className="mt-1">
                    <SubmitButton type="submit" className="text-xs text-slate-500 hover:text-slate-300 hover:underline">
                      Save as catalog item
                    </SubmitButton>
                  </form>
                  </div>
                ))}
              </div>
            </section>

            <section className="mb-10">
              <h2 className="mb-3 text-lg font-semibold text-slate-100">Add line item</h2>
              <form action={addLineItemWithId} className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Description
                  <input
                    name="description"
                    required
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Qty
                  <input
                    name="quantity"
                    defaultValue="1"
                    required
                    className="w-20 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Unit
                  <input
                    name="unit"
                    className="w-24 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Unit price
                  <input
                    name="unitPrice"
                    placeholder="cost-only"
                    title="Leave blank for a cost-only budget line (general conditions, overhead) with no client-facing price"
                    className="w-28 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Budgeted cost
                  <input
                    name="budgetedUnitCost"
                    placeholder="per unit"
                    title="Estimated unit cost — the historical baseline for WIP reporting"
                    className="w-28 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Trade
                  <select
                    name="tradeScope"
                    defaultValue=""
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">No trade tag</option>
                    {TRADE_SCOPE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <LaborHoursField crafts={craftOptions} />
                <SubmitButton
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
                >
                  Add line item
                </SubmitButton>
              </form>

              {catalogEntries.length > 0 && (
                <form action={addLineItemFromCatalogWithId} className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Add from catalog
                    <select
                      name="catalogEntryId"
                      required
                      className="min-w-[220px] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    >
                      {catalogEntries.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.description}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-slate-300">
                    Qty
                    <input
                      name="quantity"
                      defaultValue="1"
                      required
                      className="w-20 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <SubmitButton
                    type="submit"
                    className="inline-flex items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                  >
                    Add from catalog
                  </SubmitButton>
                </form>
              )}
            </section>

            <section className="mb-10">
              <h2 className="mb-1 text-lg font-semibold text-slate-100">Estimate versions</h2>
              <p className="mb-3 text-sm text-slate-400">
                A manual checkpoint of the line items above — save one before a scope change so you
                can see what this was priced at before.
              </p>
              {job.estimateVersions.length > 0 && (
                <ul className="mb-4 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
                  {job.estimateVersions.map((version) => {
                    const snapshotItems = Array.isArray(version.snapshot)
                      ? (version.snapshot as {
                          description: string;
                          quantity: string;
                          unit: string | null;
                        }[])
                      : [];
                    return (
                      <li key={version.id} className="p-3 text-sm">
                        <p className="font-medium text-slate-100">
                          v{version.versionNumber}
                          <span className="ml-2 font-normal text-slate-500">
                            {version.createdAt.toLocaleDateString()}
                            {version.createdByUser?.name || version.createdByUser?.email
                              ? ` · ${version.createdByUser.name ?? version.createdByUser.email}`
                              : ""}
                          </span>
                        </p>
                        {version.note && <p className="mt-1 text-slate-400">{version.note}</p>}
                        <p className="mt-1 text-xs text-slate-500">
                          {snapshotItems.length} line item{snapshotItems.length === 1 ? "" : "s"}:{" "}
                          {snapshotItems.map((i) => i.description).join(", ")}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
              <form action={saveEstimateVersionWithId} className="flex flex-wrap items-end gap-3">
                <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-sm text-slate-300">
                  Note (optional)
                  <input
                    name="note"
                    placeholder="e.g. Before client asked to add the backsplash"
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <SubmitButton
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  Save version
                </SubmitButton>
              </form>
            </section>

            <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-2 text-lg font-semibold text-slate-100">Ready to lock this in?</h2>
              <p className="mb-3 text-sm text-slate-400">
                Once contracted, line items can only change through a change order — this keeps an
                audit trail of anything that changes after the client agrees to it.
              </p>
              {signedSignature ? (
                <MarkContractedButton markContracted={markContractedWithId} />
              ) : (
                <p className="text-sm text-amber-400">
                  Get the client&apos;s signature above before contracting this job.
                </p>
              )}
            </section>
          </>
        ) : (
          <ChangeOrders
            jobId={job.id}
            changeOrders={changeOrderViews}
            lineItems={changeOrderTargets}
            pendingExposure={money(pendingExposure)}
          />
        )}


        <DailyFieldReports
          jobId={job.id}
          canDelete={currentUser.role === "OWNER"}
          reports={job.dailyFieldReports.map((report) => ({
            id: report.id,
            reportDate: report.reportDate.toISOString(),
            crewPresent: report.crewPresent,
            workPerformed: report.workPerformed,
            weather: report.weather,
            delays: report.delays,
            filedByName: report.filedBy?.name ?? null,
          }))}
        />

        {!isEstimateStage && showsBilling && (
          <PayApplications
            jobId={job.id}
            lineItems={payApplicationLineItemOptions}
            payApplications={payApplications}
          />
        )}
      </div>
    </div>
  );
}
