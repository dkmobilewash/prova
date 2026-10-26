import Link from "next/link";
import { prisma } from "@prova/db";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { WipNarrativeButton } from "@/components/WipNarrativeButton";
import { AddCostEntryForm } from "@/components/AddCostEntryForm";
import { costCategoryLabel } from "@/components/costCategoryLabels";
import { SubmitButton } from "@/components/SubmitButton";
import { MarkContractedButton } from "@/components/MarkContractedButton";
import { ChangeOrders, type ChangeOrderView } from "@/components/ChangeOrders";
import { TRADE_SCOPE_OPTIONS } from "@/components/JobEstimateHelpers";
import {
  changeOrderValueDelta,
  pendingChangeOrderExposure,
  pendingChangeOrderUnbookable,
  reopenBlockers,
} from "@/lib/change-order";
import { requireJob, jobCapabilities } from "@/lib/jobs/job-access";
import { loadJobEstimateData } from "@/lib/estimating/estimate-data";
import {
  EstimateLineItems,
  EstimateRecap,
  EstimateVersions,
  EstimateWallSchedule,
  rowCancelClass,
  rowConfirmClass,
  tableHeadClass,
  wideCell,
} from "@/components/job/EstimateStage";
import { todayInZone } from "@/lib/viewer-timezone";
import { loadJobDocuSign } from "@/lib/docusign/views";
import { contractExecutionFor, contractIsExecuted } from "@/lib/contract-execution";
import { money } from "@/lib/money";
import { formatPercentComplete, formatCoveragePercent, formatLoggedHours } from "@/lib/wip";
import { laborCostBasisLabel } from "@/lib/employer-burden";
import { ActionForm } from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { deleteCostEntry, markJobContracted, updateLineItemForecast } from "@/lib/actions";

const rowDeleteClass = "text-xs text-danger hover:underline";

// The line-item tables (declutter round 2): a header row and one
// `Disclosure variant="row"` per line, sharing one grid so the columns line
// up. A `<details>` cannot be a `<tr>`, hence a grid rather than a <table>.
// On a phone only the first and last columns show (the rest ride on a
// second line under the description), so nothing scrolls sideways.
const costLineGrid = "grid flex-1 min-w-0 items-baseline gap-3 grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_7rem_7rem_5rem_7rem]";

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

  const d = await loadJobEstimateData(jobRef.id, company.id);
  if (!d) throw new Error("job disappeared between checks");
  const { job, isEstimateStage, lineItemWip, jobWip, billingPosition, earnedRevenue, burdenPercentToday, timeZone } = d;

  const updateLineItemForecastWithId = (lineItemId: string) => updateLineItemForecast.bind(null, job.id, lineItemId);
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

  // The GC-facing bid document built from these lines, with its inclusions
  // and exclusions. Its own route asserts MANAGE_ESTIMATING; this tab only
  // needs VIEW_JOB_COSTS, so a member with one and not the other gets
  // NoAccess there.
  const proposalLink = (
    <Link href={`/jobs/${job.id}/proposal`} className="text-sm text-link hover:underline">
      Proposal &amp; exclusions →
    </Link>
  );

  // Job costing & WIP. After contract it leads the tab, as it always has.
  // On an ESTIMATE it is folded away at the bottom: an estimator came to
  // type line items, and cost-to-cost percent complete, earned revenue and
  // over/under billing on a job that has not started were 250 lines of
  // accounting to scroll past first.
  const costingSection = (
      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          {!isEstimateStage && <h2 className="text-lg font-semibold text-ink">Job costing &amp; WIP</h2>}
          {/* On an estimate the proposal link sits above the line items. */}
          {!isEstimateStage && proposalLink}
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
              <Link href="/settings?tab=estimating" className="text-link hover:text-link-hover">
                Settings
              </Link>{" "}
              to include them
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
              <p className="mt-1 text-xs text-warn">
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
              <p className="mt-1 text-xs text-warn">
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
              <p className={billingPosition > 0 ? "text-warn" : "text-ok"}>
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

        <div className="mt-6 rounded-lg border border-line-card bg-surface px-4 pb-1">
          <div className={`${costLineGrid} ${tableHeadClass}`}>
            <span>Line</span>
            <span className="text-right">Contract</span>
            <span className={wideCell}>Actual</span>
            <span className={wideCell}>% complete</span>
            <span className={wideCell}>Earned</span>
          </div>
          {lineItemWip.map(({ item, wip }) => {
            const tradeLabel = TRADE_SCOPE_OPTIONS.find((t) => t.value === item.tradeScope)?.label;
            return (
              <Disclosure
                key={item.id}
                variant="row"
                name="cost-line"
                summary={
                  <span className={costLineGrid}>
                    <span className="min-w-0 break-words">
                      {item.description}
                      <span className="block text-xs text-ink-muted sm:hidden">
                        Actual {money(wip.actualCostToDate)} · {formatPercentComplete(wip.percentComplete) ?? "—"} ·
                        Earned {wip.earnedRevenue != null ? money(wip.earnedRevenue) : "—"}
                      </span>
                    </span>
                    <span className="text-right tabular-nums">{money(wip.contractValue)}</span>
                    <span className={wideCell}>{money(wip.actualCostToDate)}</span>
                    <span className={wideCell}>{formatPercentComplete(wip.percentComplete) ?? "—"}</span>
                    <span className={wideCell}>{wip.earnedRevenue != null ? money(wip.earnedRevenue) : "—"}</span>
                  </span>
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ink">
                    {item.description}
                    {tradeLabel && (
                      <span className="ml-2 rounded bg-rail-hover px-1.5 py-0.5 text-xs text-ink-body">
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
                    className="rounded-md bg-rail-hover px-3 py-1.5 text-sm font-medium text-ink hover:bg-lift"
                  >
                    Save forecast
                  </SubmitButton>
                </ActionForm>
              </Disclosure>
            );
          })}
        </div>
      </section>
  );

  return (
    <div>
      {!isEstimateStage && costingSection}

      {isEstimateStage ? (
        <>
          <div className="mb-6 flex justify-end">{proposalLink}</div>

          <EstimateLineItems data={d} />

          <EstimateRecap data={d} />

          <section id="job-lock-in" className="mb-10 scroll-mt-4 rounded-lg border border-line-card bg-surface p-4" data-tour="job-lock-in">
            <h2 className="mb-2 text-lg font-semibold text-ink">Ready to lock this in?</h2>
            <p className="mb-3 text-sm text-ink-body">
              Once contracted, line items can only change through a change order — this keeps an audit trail of
              anything that changes after the client agrees to it.
            </p>
            {isContractExecuted ? (
              <MarkContractedButton markContracted={markContractedWithId} />
            ) : (
              <p className="text-sm text-warn">
                This job has no executed contract yet. Either send the GC a signing link on the Overview tab and
                wait for them to sign it in C Stream, or — if they already sent you the executed subcontract —
                record it there under Contract signature.
              </p>
            )}
          </section>


          {/* Collapsed by default (density audit #3): every wall run is an
              open edit form, and the lines it generates are already in the
              table above. */}
          <EstimateWallSchedule data={d} />

          <EstimateVersions data={d} />

          <details className="mb-10 rounded-lg border border-line-card p-4">
            <summary className="cursor-pointer text-lg font-semibold text-ink">
              Job costing &amp; WIP <span className="text-sm font-normal text-ink-muted">— for once the work starts</span>
            </summary>
            <div className="mt-4">{costingSection}</div>
          </details>
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
