import Link from "next/link";
import { prisma } from "@prova/db";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { WipNarrativeButton } from "@/components/WipNarrativeButton";
import { DraftLineItemsForm } from "@/components/DraftLineItemsForm";
import { TakeoffForm } from "@/components/TakeoffForm";
import { AddCostEntryForm } from "@/components/AddCostEntryForm";
import { costCategoryLabel } from "@/components/costCategoryLabels";
import { LaborHoursField } from "@/components/LaborHoursField";
import { PhaseCodeField } from "@/components/PhaseCodeField";
import { SubmitButton } from "@/components/SubmitButton";
import { MarkContractedButton } from "@/components/MarkContractedButton";
import { ChangeOrders, type ChangeOrderView } from "@/components/ChangeOrders";
import { TRADE_SCOPE_OPTIONS, PriceBasisBadge, LaborCostHint } from "@/components/JobEstimateHelpers";
import {
  changeOrderValueDelta,
  pendingChangeOrderExposure,
  pendingChangeOrderUnbookable,
  reopenBlockers,
} from "@/lib/change-order";
import { requireJob, jobCapabilities } from "@/lib/jobs/job-access";
import { viewerTimeZone } from "@/lib/viewerToday";
import { todayInZone } from "@/lib/viewer-timezone";
import { formatInstant } from "@/lib/render-date";
import { loadJobDocuSign } from "@/lib/docusign/views";
import { contractExecutionFor, contractIsExecuted } from "@/lib/contract-execution";
import { money } from "@/lib/money";
import {
  calculateLineItemWip,
  calculateJobWip,
  formatPercentComplete,
  formatCoveragePercent,
  formatLoggedHours,
} from "@/lib/wip";
import { jobEarnedRevenue, jobOverUnderBilling } from "@/lib/company-financials";
import { lineItemCostToDate, unassignedLaborCost } from "@/lib/labor-job-cost";
import { loadEmployerBurdenRates } from "@/lib/employer-burden-query";
import { employerBurdenPercentOnDay, laborCostBasisLabel } from "@/lib/employer-burden";
import { serverToday } from "@/lib/serverToday";
import { burdenedHourlyRate, estimateBurdenedLaborCost, laborRateDateFor } from "@/lib/estimate-labor-cost";
import { ActionForm } from "@/components/ActionForm";
import {
  addLineItem,
  addLineItemFromCatalog,
  deleteCostEntry,
  deleteLineItem,
  markJobContracted,
  saveEstimateVersion,
  saveLineItemAsCatalogEntry,
  updateLineItem,
  updateLineItemForecast,
} from "@/lib/actions";

const rowDeleteClass = "text-xs text-red-400 hover:underline";
const rowCancelClass =
  "rounded-md border border-slate-700 px-2 py-1 text-xs text-ink-label hover:border-slate-500";
const rowConfirmClass =
  "rounded-md border border-red-500 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10";

/**
 * Estimate — pricing and job costing. Withheld on VIEW_JOB_COSTS exactly
 * like the monolith's own `!showsJobMoney ? null : …` did: a SOFT gate,
 * not `requireCapability`/`<NoAccess>`, and deliberately so.
 *
 * `certified-payroll/page.tsx` and the Photos tab next to this one DO use
 * the hard `requireCapability` wall — but their Server Actions are
 * independently guarded (Photos' job-media actions are also reachable
 * from the already-guarded top-level `/photos`, so they had to be).
 * `lib/action-capability-guards.test.ts` found that this tab's own
 * actions are not: they were reachable only from the old monolith's
 * `/jobs/[id]`, which stays open on purpose (see `lib/permissions.ts`'s
 * `ROUTE_CAPABILITY` comment), so nothing ever required them to assert
 * VIEW_JOB_COSTS themselves. A hard route guard here would CLAIM a
 * boundary the action layer does not back up — worse than no guard,
 * because it looks enforced and isn't (the exact shape `lib/authz.ts`'s
 * own doc comment warns about). So this route withholds its content the
 * same way the monolith did, which is the same security posture as
 * before: not tightened, not loosened. Tracked in issue #383 (Diego's
 * lane, which owns these actions) rather than fixed here — out of scope
 * for a layout PR, and the issue's own detail is held privately since it
 * names exactly what is unguarded on a public repo.
 */
export default async function JobEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { company, currentUser, principal, job: jobRef } = await requireJob(id);
  const { showsJobMoney } = jobCapabilities(principal);
  if (!showsJobMoney) {
    return (
      <p className="text-sm text-ink-muted">This tab isn&rsquo;t part of your access.</p>
    );
  }

  const job = await prisma.job.findUnique({
    where: { id: jobRef.id },
    include: {
      // `startDate`, not selected: `include` with nested selects still
      // returns every scalar column on Job, unlike a top-level `select`.
      contact: { select: { name: true, email: true } },
      signatureRequests: { select: { status: true, signerName: true, signedAt: true } },
      contractDocuments: {
        orderBy: { versionNumber: "desc" },
        select: {
          versionNumber: true,
          fileName: true,
          fileUrl: true,
          executedSignedDate: true,
          createdAt: true,
          uploadedByUser: { select: { name: true, email: true } },
        },
      },
      lineItems: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        include: {
          originChangeOrder: true,
          costEntries: { orderBy: { incurredAt: "desc" } },
          craftClassification: { include: { unionLocal: true } },
        },
      },
      estimateVersions: { orderBy: { versionNumber: "desc" }, include: { createdByUser: true } },
      changeOrders: {
        orderBy: { number: "asc" },
        include: {
          edits: true,
          proposals: { orderBy: { createdAt: "asc" } },
          supersedes: { select: { number: true } },
          revisions: { select: { number: true }, orderBy: { number: "asc" } },
        },
      },
      // Every hour on the job, not just hours tied to a line item — the
      // WIP total below includes labor logged with no line item, same as
      // the monolith's `unassignedLaborCost(job.timeEntries, …)`. Per diem
      // and travel pay are part of that cost too (CLAUDE.md, #375/#369) —
      // dropping them here would silently under-cost every WIP figure on
      // this route, the exact shape of bug those PRs exist to prevent.
      timeEntries: {
        select: {
          hours: true,
          payType: true,
          date: true,
          craftClassificationId: true,
          lineItemId: true,
          perDiemAmount: true,
          travelPayAmount: true,
        },
      },
      invoices: { select: { amount: true } },
    },
  });
  if (!job) throw new Error("job disappeared between checks");

  const isEstimateStage = job.status === "ESTIMATE";

  const [catalogEntries, craftClassifications, phaseCodes, employerBurdenRates] = await Promise.all([
    prisma.lineItemCatalogEntry.findMany({ where: { companyId: company.id }, orderBy: { description: "asc" } }),
    prisma.craftClassification.findMany({
      where: { companyId: company.id },
      include: {
        unionLocal: true,
        fringeRateSchedules: { orderBy: { effectiveFrom: "desc" } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.phaseCode.findMany({
      where: { companyId: company.id },
      select: { id: true, code: true, name: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    // The employer's share on top of wage and fringes -- FICA, FUTA/SUTA,
    // workers' comp -- as the owner recorded it on /settings. Empty for a
    // company that has recorded none, which adds nothing and leaves every
    // figure below exactly as it was.
    loadEmployerBurdenRates(company.id),
  ]);

  const laborRateDate = laborRateDateFor(job, new Date());
  const schedulesByCraft = new Map(
    craftClassifications.map((craft) => [
      craft.id,
      craft.fringeRateSchedules.map((schedule) => ({
        baseWage: Number(schedule.baseWage),
        pensionRate: schedule.pensionRate != null ? Number(schedule.pensionRate) : null,
        vacationRate: schedule.vacationRate != null ? Number(schedule.vacationRate) : null,
        healthWelfareRate: schedule.healthWelfareRate != null ? Number(schedule.healthWelfareRate) : null,
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

  const lineItemWip = job.lineItems.map((item) => ({
    item,
    wip: calculateLineItemWip({
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      budgetedUnitCost: item.budgetedUnitCost != null ? Number(item.budgetedUnitCost) : null,
      currentEstimatedUnitCost: item.currentEstimatedUnitCost != null ? Number(item.currentEstimatedUnitCost) : null,
      estimatedCostToComplete: item.estimatedCostToComplete != null ? Number(item.estimatedCostToComplete) : null,
      ...lineItemCostToDate(
        item.id,
        item.costEntries,
        job.timeEntries,
        schedulesByCraft,
        employerBurdenRates,
      ),
    }),
  }));

  const billedToDate = job.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  const jobWip = calculateJobWip(
    lineItemWip.map((l) => l.wip),
    billedToDate,
    unassignedLaborCost(job.timeEntries, schedulesByCraft, employerBurdenRates),
  );
  const billingPosition = jobOverUnderBilling(jobWip);
  const earnedRevenue = jobEarnedRevenue(jobWip);
  // Only for the sentence under the heading. Nothing computed above reads it
  // -- the dollars use each TIME ENTRY's own day, not today's.
  const burdenPercentToday = employerBurdenPercentOnDay(employerBurdenRates, serverToday());

  const addLineItemWithId = addLineItem.bind(null, job.id);
  const addLineItemFromCatalogWithId = addLineItemFromCatalog.bind(null, job.id);
  const saveEstimateVersionWithId = saveEstimateVersion.bind(null, job.id);
  const updateLineItemWithId = (lineItemId: string) => updateLineItem.bind(null, job.id, lineItemId);
  const updateLineItemForecastWithId = (lineItemId: string) => updateLineItemForecast.bind(null, job.id, lineItemId);
  const deleteLineItemWithId = (lineItemId: string) => deleteLineItem.bind(null, job.id, lineItemId);
  const deleteCostEntryWithId = (costEntryId: string) => deleteCostEntry.bind(null, job.id, costEntryId);
  const markContractedWithId = markJobContracted.bind(null, job.id);

  // Change orders (post-contract branch only — cheap to compute either
  // way since job.changeOrders is empty pre-contract in practice, and
  // computing it unconditionally keeps this one code path instead of two).
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
      targetDescription: proposal.lineItemId ? changeOrderTargetsById.get(proposal.lineItemId)?.description ?? null : null,
      summary: describeProposal(proposal),
    })),
    edits: co.edits.map((edit) => ({ id: edit.id, field: edit.field, oldValue: edit.oldValue, newValue: edit.newValue })),
  }));

  const pendingExposure = Number(pendingChangeOrderExposure(job.changeOrders, changeOrderTargetsById));
  const pendingUnbookable = pendingChangeOrderUnbookable(job.changeOrders, changeOrderTargetsById);

  const timeZone = await viewerTimeZone();
  const docuSign = await loadJobDocuSign(company.id, job.id, timeZone);
  const docuSignSigner = { name: job.contact.name, email: job.contact.email ?? "" };

  // Whether this job's contract is executed — the "Ready to lock this in?"
  // button only offers MarkContracted once it is. Same evidence Overview
  // computes for its own Contract signature section, re-derived here from
  // this route's own (smaller) fetch rather than shared across routes.
  const signedSignature = job.signatureRequests.find((s) => s.status === "SIGNED") ?? null;
  const contractExecution = contractExecutionFor(
    signedSignature ? { signerName: signedSignature.signerName, signedAt: signedSignature.signedAt } : null,
    job.contractDocuments.map((doc) => ({
      versionNumber: doc.versionNumber,
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      executedSignedDate: doc.executedSignedDate,
      recordedAt: doc.createdAt,
      recordedByName: doc.uploadedByUser?.name ?? doc.uploadedByUser?.email ?? null,
    })),
  );
  const isContractExecuted = contractIsExecuted(contractExecution);

  return (
    <div>
      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">Job costing &amp; WIP</h2>
          {/* The GC-facing bid document built from these lines, with its
              inclusions and exclusions. Its own route asserts
              MANAGE_ESTIMATING; this tab only needs VIEW_JOB_COSTS, so a
              member with one and not the other gets NoAccess there. */}
          <Link href={`/jobs/${job.id}/proposal`} className="text-sm text-link hover:underline">
            Proposal &amp; exclusions →
          </Link>
        </div>
        {/* WHAT THE LABOR IN THESE FIGURES IS MADE OF, SAID OUT LOUD AND
            DRIVEN BY THE DATA. This screen used to describe logged hours as
            "burdened", which to a contractor means fully loaded -- employer
            FICA, FUTA/SUTA and workers' comp included -- while the
            arithmetic was base wage and CBA fringes and nothing else. With
            no EmployerBurdenRate recorded this now says "wage and fringes",
            which is what it has always computed; record one on Settings and
            the sentence changes with the number. */}
        <p className="mb-3 text-xs text-ink-muted">
          Cost-to-cost percentage of completion. Logged hours are costed at{" "}
          {laborCostBasisLabel(burdenPercentToday)}
          {burdenPercentToday === null ? (
            <>
              {" "}
              — employer payroll taxes and workers&apos; comp are not in these figures. Record an
              employer burden percentage on{" "}
              <Link href="/settings" className="text-link hover:text-link-hover">
                Settings
              </Link>{" "}
              to include them.
            </>
          ) : (
            ", applied to the base wage and not to the fringes"
          )}
          .
        </p>

        <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-line-card bg-surface p-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-ink-muted">Contract value</p>
            <p className="text-ink">{money(jobWip.contractValue)}</p>
          </div>
          <div>
            <p className="text-xs text-ink-muted">Actual cost to date</p>
            <p className="text-ink">{money(jobWip.actualCostToDate)}</p>
            {jobWip.unpricedLaborHours > 0 && (
              <p className="mt-1 text-xs text-amber-400">
                {formatLoggedHours(jobWip.unpricedLaborHours)} of{" "}
                {formatLoggedHours(jobWip.pricedLaborHours + jobWip.unpricedLaborHours)} logged hours have no craft
                tag or no effective fringe rate schedule, so they are in this figure at $0 of wages (
                {formatCoveragePercent(jobWip.laborHourCoverage)} of hours priced).
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-ink-muted">% complete</p>
            <p className="text-ink">{formatPercentComplete(jobWip.percentComplete) ?? "—"}</p>
            {jobWip.percentComplete != null && (jobWip.estimatedCoverage < 1 || jobWip.costCoverage < 1) && (
              <p className="mt-1 text-xs text-amber-400">
                Over the {formatCoveragePercent(jobWip.estimatedCoverage)} of contract value that carries a cost
                forecast
                {jobWip.costCoverage < 1 ? `, and ${formatCoveragePercent(jobWip.costCoverage)} of cost to date` : ""}
                .
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-ink-muted">Earned revenue</p>
            <p className="text-ink">{earnedRevenue != null ? money(earnedRevenue) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-muted">Billed to date</p>
            <p className="text-ink">{money(jobWip.billedToDate)}</p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className="text-xs text-ink-muted">Over / under billed</p>
            {billingPosition === null ? (
              <p className="text-ink-body">
                Only {formatCoveragePercent(jobWip.earnedCoverage)} of this job&apos;s value has an earned-revenue
                figure, so a billing position would be guesswork. Budget the rest to see where it lands.
              </p>
            ) : (
              <p className={billingPosition > 0 ? "text-amber-400" : "text-green-400"}>
                {billingPosition > 0
                  ? `Overbilled ${money(billingPosition)}`
                  : billingPosition < 0
                    ? `Underbilled ${money(Math.abs(billingPosition))}`
                    : "Even"}
              </p>
            )}
          </div>
        </div>

        <WipNarrativeButton jobId={job.id} />

        <div className="mt-6 flex flex-col gap-4">
          {lineItemWip.map(({ item, wip }) => {
            const tradeLabel = TRADE_SCOPE_OPTIONS.find((t) => t.value === item.tradeScope)?.label;
            return (
              <div key={item.id} className="rounded-lg border border-line-card bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ink">
                    {item.description}
                    {tradeLabel && (
                      <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-ink-body">
                        {tradeLabel}
                      </span>
                    )}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span className="text-ink-body">Contract {money(wip.contractValue)}</span>
                  <span className="text-ink-body">Budget {wip.budgetedCost != null ? money(wip.budgetedCost) : "—"}</span>
                  <span className="text-ink-body">
                    Current est. {wip.currentEstimatedCost != null ? money(wip.currentEstimatedCost) : "—"}
                  </span>
                  <span className="text-ink-body">Actual {money(wip.actualCostToDate)}</span>
                  <span className="text-ink-body">% complete {formatPercentComplete(wip.percentComplete) ?? "—"}</span>
                  <span className="text-ink-body">Earned {wip.earnedRevenue != null ? money(wip.earnedRevenue) : "—"}</span>
                </div>

                {item.costEntries.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 border-t border-line-row pt-3">
                    {item.costEntries.map((entry) => (
                      <li key={entry.id} className="flex items-center justify-between text-sm">
                        <span className="text-ink-label">
                          {entry.description}{" "}
                          {/* Printed the raw enum until 2026-09-21 —
                              "(SUBCONTRACTOR)", "(MATERIAL)" — beside every
                              cost a contractor has logged. */}
                          <span className="text-xs text-ink-muted">
                            ({costCategoryLabel(entry.category)})
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-ink">{money(Number(entry.amount))}</span>
                          <RowActions
                            as="span"
                            className="flex shrink-0 items-center justify-end gap-2"
                            destructive={
                              <ConfirmDelete
                                pinned="end"
                                action={deleteCostEntryWithId(entry.id)}
                                describe="Removes this cost from the job. Job cost and margin are recalculated without it; nothing is refunded or unbilled."
                                label="Remove"
                                confirmLabel="Confirm remove"
                                deleteClassName={rowDeleteClass}
                                cancelClassName={rowCancelClass}
                                confirmClassName={rowConfirmClass}
                              />
                            }
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <AddCostEntryForm jobId={job.id} lineItemId={item.id} defaultTradeScope={item.tradeScope} />

                <ActionForm
                  action={updateLineItemForecastWithId(item.id)}
                  resetOnSuccess={false}
                  className="mt-3 flex flex-wrap items-end gap-2 border-t border-line-row pt-3"
                >
                  <label className="flex flex-col gap-1 text-xs text-ink-body">
                    Re-forecast current unit cost
                    <input
                      name="currentEstimatedUnitCost"
                      type="text"
                      inputMode="decimal"
                      defaultValue={item.currentEstimatedUnitCost?.toString() ?? ""}
                      placeholder="per unit"
                      className="w-28 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-ink-body">
                    Override cost-to-complete
                    <input
                      name="estimatedCostToComplete"
                      type="text"
                      inputMode="decimal"
                      defaultValue={item.estimatedCostToComplete?.toString() ?? ""}
                      placeholder="leave blank to auto-derive"
                      title="Overrides the mechanical (current estimate - actual) calculation — use when you know something the cost data doesn't reflect yet"
                      className="w-44 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                    />
                  </label>
                  <SubmitButton
                    type="submit"
                    className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-ink hover:bg-neutral-700"
                  >
                    Save forecast
                  </SubmitButton>
                </ActionForm>
              </div>
            );
          })}
        </div>
      </section>

      {isEstimateStage ? (
        <>
          <section className="mb-10" data-tour="job-line-items">
            <h2 className="mb-3 text-lg font-semibold text-ink">Line items (estimate)</h2>
            <DraftLineItemsForm jobId={job.id} initialScope={job.scope ?? ""} />
            <TakeoffForm jobId={job.id} />
            {/* The other way in. This form does the arithmetic from
                dimensions somebody already has; the Takeoff tab is where you
                get those dimensions off a drawing. */}
            <p className="mb-3 text-sm text-ink-muted">
              Working from a PDF instead?{" "}
              <Link href={`/jobs/${job.id}/takeoff`} className="text-link hover:text-link-hover">
                Measure off a plan
              </Link>{" "}
              — set the scale on a sheet and trace what you&rsquo;re taking off.
            </p>
            <div className="rounded-lg border border-line-card bg-surface p-4">
              {job.lineItems.length === 0 && <p className="py-2 text-sm text-ink-body">No line items yet — add one below.</p>}
              {job.lineItems.map((item) => (
                <div key={item.id} className="border-t border-line-row py-3 first:border-t-0">
                  <ActionForm action={updateLineItemWithId(item.id)} resetOnSuccess={false} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.aiDrafted && <PriceBasisBadge basis={item.priceBasis} />}
                      <input
                        name="description"
                        defaultValue={item.description}
                        required
                        placeholder="Description"
                        className="min-w-[160px] flex-1 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
                      />
                      <input
                        name="quantity"
                        type="text"
                        inputMode="decimal"
                        defaultValue={item.quantity.toString()}
                        required
                        title="Quantity"
                        className="w-16 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
                      />
                      <input
                        name="unit"
                        defaultValue={item.unit ?? ""}
                        placeholder="Unit"
                        className="w-20 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
                      />
                      <select
                        name="tradeScope"
                        defaultValue={item.tradeScope ?? ""}
                        className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
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
                      <label className="flex items-center gap-1 text-xs text-ink-body">
                        Unit price
                        <input
                          name="unitPrice"
                          type="text"
                          inputMode="decimal"
                          defaultValue={item.unitPrice?.toString() ?? ""}
                          placeholder="cost-only"
                          title="Leave blank for a cost-only budget line (general conditions, overhead) with no client-facing price"
                          className="w-24 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-ink-body">
                        Budgeted cost
                        <input
                          name="budgetedUnitCost"
                          type="text"
                          inputMode="decimal"
                          defaultValue={item.budgetedUnitCost?.toString() ?? ""}
                          placeholder="per unit"
                          title="Estimated unit cost at estimate approval — the frozen historical baseline for WIP reporting"
                          className="w-24 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-ink-body">
                        Labor hrs
                        <input
                          name="laborHours"
                          type="text"
                          inputMode="decimal"
                          defaultValue={item.laborHours?.toString() ?? ""}
                          placeholder="hrs"
                          className="w-16 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                        />
                      </label>
                      <LaborCostHint cost={estimatedLaborCostByLineItem.get(item.id) ?? null} />
                      <select
                        name="craftClassificationId"
                        defaultValue={item.craftClassificationId ?? ""}
                        title="Craft classification"
                        className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
                      >
                        <option value="">No craft tag</option>
                        {craftClassifications.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.unionLocal.parentInternational} {c.unionLocal.localNumber} — {c.name}
                          </option>
                        ))}
                      </select>
                      <PhaseCodeField
                        phaseCodes={phaseCodes}
                        selectedId={item.phaseCodeId}
                        labelled={false}
                        className="rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
                      />
                      <SubmitButton
                        type="submit"
                        title="Save"
                        className="rounded-md bg-neutral-800 px-2 py-1 text-xs font-medium text-ink hover:bg-neutral-700"
                      >
                        Save
                      </SubmitButton>
                    </div>
                  </ActionForm>
                  <RowActions
                    className="mt-1 flex flex-wrap items-center justify-end gap-3"
                    destructive={
                      <ConfirmDelete
                        pinned="end"
                        action={deleteLineItemWithId(item.id)}
                        describe="Removes the line and its cost history from the estimate. The contract value drops by its amount. A line already billed on a pay application cannot be removed."
                        label="Remove"
                        confirmLabel="Confirm remove"
                        deleteClassName="rounded-md bg-red-950 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-900"
                        cancelClassName={rowCancelClass}
                        confirmClassName={rowConfirmClass}
                        hint={
                          <span className="max-w-[18rem] text-right text-ink-muted">
                            The line comes off the estimate and its price out of the total. It is marked deleted
                            rather than erased, so change-order history keeps it.
                          </span>
                        }
                      />
                    }
                  >
                    <form action={saveLineItemAsCatalogEntry.bind(null, item.id)}>
                      <SubmitButton type="submit" className="text-xs text-ink-muted hover:text-ink-label hover:underline">
                        Save as catalog item
                      </SubmitButton>
                    </form>
                  </RowActions>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-10" data-tour="job-add-line-item">
            <h2 className="mb-3 text-lg font-semibold text-ink">Add line item</h2>
            <ActionForm action={addLineItemWithId} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Description
                <input
                  name="description"
                  required
                  className="rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Qty
                <input
                  name="quantity"
                  type="text"
                  inputMode="decimal"
                  defaultValue="1"
                  required
                  className="w-20 rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Unit
                <input
                  name="unit"
                  className="w-24 rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Unit price
                <input
                  name="unitPrice"
                  type="text"
                  inputMode="decimal"
                  placeholder="cost-only"
                  title="Leave blank for a cost-only budget line (general conditions, overhead) with no client-facing price"
                  className="w-28 rounded-md border border-line-card bg-surface px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Budgeted cost
                <input
                  name="budgetedUnitCost"
                  type="text"
                  inputMode="decimal"
                  placeholder="per unit"
                  title="Estimated unit cost — the historical baseline for WIP reporting"
                  className="w-28 rounded-md border border-line-card bg-surface px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Trade
                <select
                  name="tradeScope"
                  defaultValue=""
                  className="rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
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
              <PhaseCodeField phaseCodes={phaseCodes} />
              <SubmitButton
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-ink hover:bg-neutral-700"
              >
                Add line item
              </SubmitButton>
            </ActionForm>

            {catalogEntries.length > 0 && (
              <ActionForm action={addLineItemFromCatalogWithId} className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm text-ink-label">
                  Add from catalog
                  <select
                    name="catalogEntryId"
                    required
                    className="min-w-[220px] rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
                  >
                    {catalogEntries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.description}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink-label">
                  Qty
                  <input
                    name="quantity"
                    type="text"
                    inputMode="decimal"
                    defaultValue="1"
                    required
                    className="w-20 rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
                  />
                </label>
                <SubmitButton
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
                >
                  Add from catalog
                </SubmitButton>
              </ActionForm>
            )}
          </section>

          <section className="mb-10">
            <h2 className="mb-1 text-lg font-semibold text-ink">Estimate versions</h2>
            <p className="mb-3 text-sm text-ink-body">
              A manual checkpoint of the line items above — save one before a scope change so you can see what this
              was priced at before.
            </p>
            {job.estimateVersions.length > 0 && (
              <ul className="mb-4 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
                {job.estimateVersions.map((version) => {
                  const snapshotItems = Array.isArray(version.snapshot)
                    ? (version.snapshot as { description: string; quantity: string; unit: string | null }[])
                    : [];
                  return (
                    <li key={version.id} className="p-3 text-sm">
                      <p className="font-medium text-ink">
                        v{version.versionNumber}
                        <span className="ml-2 font-normal text-ink-muted">
                          {formatInstant(version.createdAt, timeZone, "numeric")}
                          {version.createdByUser?.name || version.createdByUser?.email
                            ? ` · ${version.createdByUser.name ?? version.createdByUser.email}`
                            : ""}
                        </span>
                      </p>
                      {version.note && <p className="mt-1 text-ink-body">{version.note}</p>}
                      <p className="mt-1 text-xs text-ink-muted">
                        {snapshotItems.length} line item{snapshotItems.length === 1 ? "" : "s"}:{" "}
                        {snapshotItems.map((i) => i.description).join(", ")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <form action={saveEstimateVersionWithId} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-sm text-ink-label">
                Note (optional)
                <input
                  name="note"
                  placeholder="e.g. Before client asked to add the backsplash"
                  className="rounded-md border border-line-card bg-surface px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                />
              </label>
              <SubmitButton
                type="submit"
                className="inline-flex items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-neutral-800"
              >
                Save version
              </SubmitButton>
            </form>
          </section>

          <section className="mb-10 rounded-lg border border-line-card bg-surface p-4" data-tour="job-lock-in">
            <h2 className="mb-2 text-lg font-semibold text-ink">Ready to lock this in?</h2>
            <p className="mb-3 text-sm text-ink-body">
              Once contracted, line items can only change through a change order — this keeps an audit trail of
              anything that changes after the client agrees to it.
            </p>
            {isContractExecuted ? (
              <MarkContractedButton markContracted={markContractedWithId} />
            ) : (
              <p className="text-sm text-amber-400">
                This job has no executed contract yet. Either send the GC a signing link on the Overview tab and
                wait for them to sign it in C Stream, or — if they already sent you the executed subcontract —
                record it there under Contract signature.
              </p>
            )}
          </section>
        </>
      ) : (
        <ChangeOrders
          jobId={job.id}
          // The reader's calendar day, resolved on the SERVER from the
          // same zone the DocuSign panel above already uses. It is a prop
          // rather than something the component works out because those
          // date defaults are server-rendered markup — see the note above
          // `TodayProp` in components/ChangeOrders.tsx.
          today={todayInZone(timeZone)}
          changeOrders={changeOrderViews}
          lineItems={changeOrderTargets}
          pendingExposure={money(pendingExposure)}
          pendingUnbookable={pendingUnbookable}
          docuSign={{
            jobId: job.id,
            state: docuSign.state,
            autoUpdates: docuSign.autoUpdates,
            canVoid: currentUser.role === "OWNER",
            defaultSigner: docuSignSigner,
            byChangeOrder: Object.fromEntries(docuSign.byChangeOrder),
          }}
        />
      )}
    </div>
  );
}
