import Link from "next/link";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { DraftLineItemsForm } from "@/components/DraftLineItemsForm";
import { TakeoffForm } from "@/components/TakeoffForm";
import { LaborHoursField } from "@/components/LaborHoursField";
import { PhaseCodeField } from "@/components/PhaseCodeField";
import { SubmitButton } from "@/components/SubmitButton";
import { ApplyEstimateTemplate } from "@/components/ApplyEstimateTemplate";
import { dominantTradeScope } from "@/lib/estimate-templates";
import { TRADE_SCOPE_OPTIONS, PriceBasisBadge, LaborCostHint, ProductionBackCheckHint } from "@/components/JobEstimateHelpers";
import { formatInstant } from "@/lib/render-date";
import { money } from "@/lib/money";
import { UseLaborCostButton } from "@/components/UseLaborCostButton";
import { MissingIndirects } from "@/components/MissingIndirects";
import { EstimateCrossChecks } from "@/components/EstimateCrossChecks";
import { PriceAnomalies } from "@/components/PriceAnomalies";
import { laborCostBasisLabel } from "@/lib/employer-burden";
import { ActionForm } from "@/components/ActionForm";
import { CollapsedForm } from "@/components/CollapsedForm";
import { Disclosure } from "@/components/Disclosure";
import { WallSchedule } from "@/components/WallSchedule";
import { UpdatePricesPanel } from "@/components/UpdatePricesPanel";
import { BidRecapPanel } from "@/components/BidRecapPanel";
import {
  addLineItem,
  addLineItemFromCatalog,
  deleteLineItem,
  saveEstimateVersion,
  saveLineItemAsCatalogEntry,
  updateLineItem,
} from "@/lib/actions";
import { surfaceHrefs, type Surface } from "@/lib/bid/surfaceHrefs";
import type { JobEstimateData } from "@/lib/estimating/estimate-data";

/**
 * THE ESTIMATE SCREEN'S SECTIONS, shared by the CRM's Estimate tab and C Stream
 * Bid's estimate screens.
 *
 * Each section below is the JSX that used to sit inline in
 * `app/(app)/jobs/[id]/(tabs)/estimate/page.tsx`, moved here WITHOUT being
 * rewritten (the comments in it are the page's own), so the two products
 * render the same lines, the same recap and the same wall schedule from one
 * implementation. What each one reads is `loadJobEstimateData`'s result,
 * passed whole as `data`.
 *
 * `surface` picks the links (`lib/bid/surfaceHrefs.ts`): the default, "crm",
 * is today's href for every one of them, so the CRM page is unchanged; C
 * Stream Bid passes "bid" and no link in any of these leaves Bid
 * (`lib/bid/bidLinkCensus.test.ts` holds that).
 */

// Shared with the page's post-award sections (the costing table uses the same row furniture).
export const estimateLineGrid = "grid flex-1 min-w-0 items-baseline gap-3 grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_4rem_4rem_6rem_7rem]";
export const tableHeadClass = "border-b border-line-row py-2 pl-5 text-xs font-medium text-ink-muted";
export const wideCell = "hidden text-right tabular-nums sm:block";
export const rowCancelClass =
  "rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:border-line-card";
export const rowConfirmClass =
  "rounded-md border border-red-500 px-2 py-1 text-xs text-danger hover:bg-red-500/10";

/** The estimate's line items, their edit forms and the four ways to add one. */
export function EstimateLineItems({ data, surface = "crm" }: { data: JobEstimateData; surface?: Surface }) {
  const { job, catalogEntries, craftClassifications, phaseCodes, estimateTemplates, bidDefaults, burdenPercentForBid, craftOptions, estimatedLaborCostByLineItem, laborCostApplyByLineItem, lineItemWip, productivityByLineItem, jobWip } = data;
  const hrefs = surfaceHrefs(surface, job.id);
  const addLineItemWithId = addLineItem.bind(null, job.id);
  const addLineItemFromCatalogWithId = addLineItemFromCatalog.bind(null, job.id);
  const updateLineItemWithId = (lineItemId: string) => updateLineItem.bind(null, job.id, lineItemId);
  const deleteLineItemWithId = (lineItemId: string) => deleteLineItem.bind(null, job.id, lineItemId);
  return (
      <section className="mb-10" data-tour="job-line-items">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">Line items (estimate)</h2>
          {/* The same sum of quantity x unit price the costing section
              below calls Contract value (`calculateJobWip`), read here
              rather than added up again. */}
          <p className="text-sm text-ink-body">
            Lines total <span className="font-semibold tabular-nums text-ink">{money(jobWip.contractValue)}</span>
          </p>
        </div>
        {/* SEE IT, THEN CLICK INTO IT (declutter round 2). Every line used
            to be an open edit form, ~10 inputs each. Now one summary row
            per line; opening a row shows exactly the form it always had,
            same action and fields, and `name` keeps one open at a time. */}
        <div className="rounded-lg border border-line-card bg-surface px-4 pb-1">
          {lineItemWip.length === 0 ? (
            <p className="py-3 text-sm text-ink-body">No line items yet — add one below.</p>
          ) : (
            <div className={`${estimateLineGrid} ${tableHeadClass}`}>
              <span>Description</span>
              <span className={wideCell}>Qty</span>
              <span className="hidden sm:block">Unit</span>
              <span className={wideCell}>Unit price</span>
              <span className="text-right">Total</span>
            </div>
          )}
          {lineItemWip.map(({ item, wip }) => (
            <Disclosure
              key={item.id}
              variant="row"
              name="estimate-line"
              summary={
                <span className={estimateLineGrid}>
                  <span className="min-w-0 break-words">
                    {item.description}
                    <span className="block text-xs text-ink-muted sm:hidden">
                      {item.quantity.toString()} {item.unit ?? ""} @{" "}
                      {item.unitPrice != null ? money(Number(item.unitPrice)) : "cost-only"}
                    </span>
                  </span>
                  <span className={wideCell}>{item.quantity.toString()}</span>
                  <span className="hidden text-ink-body sm:block">{item.unit ?? "—"}</span>
                  <span className={wideCell}>
                    {item.unitPrice != null ? money(Number(item.unitPrice)) : "cost-only"}
                  </span>
                  <span className="text-right tabular-nums">
                    {item.unitPrice != null ? money(wip.contractValue) : "—"}
                  </span>
                </span>
              }
            >
              <ActionForm action={updateLineItemWithId(item.id)} resetOnSuccess={false} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {item.aiDrafted && <PriceBasisBadge basis={item.priceBasis} />}
                  {item.wallTypeComponentId && (
                    <span
                      className="inline-flex items-center rounded-full bg-rail-hover px-2 py-0.5 text-xs font-medium text-ink-label"
                      title="Worked out from the wall schedule above. Its quantity follows the runs; the price is yours to change."
                    >
                      From wall schedule
                    </span>
                  )}
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
                    className="min-w-0 max-w-full rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
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
                  <label className="flex items-center gap-1 text-xs text-ink-body">
                    Rate
                    <input
                      name="productionRate"
                      inputMode="decimal"
                      defaultValue={item.productionRate?.toString() ?? ""}
                      placeholder="units/hr"
                      title="Units per hour — the productivity this line is estimated at. Hours = quantity ÷ rate unless Labor hrs is filled in (which overrides)."
                      className="w-20 rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                    />
                  </label>
                  <LaborCostHint
                    cost={estimatedLaborCostByLineItem.get(item.id) ?? null}
                    basis={laborCostBasisLabel(burdenPercentForBid)}
                    // A line with no budgeted cost is left out of the bid's
                    // cost base entirely and marked up at nothing — the
                    // recap's own `pricedWithNoCost`. Saying so here is the
                    // half of #614 that fixes the money bug.
                    inBid={item.budgetedUnitCost != null}
                  />
                  <UseLaborCostButton
                    jobId={job.id}
                    lineItemId={item.id}
                    decision={laborCostApplyByLineItem.get(item.id)!}
                    inBid={item.budgetedUnitCost != null}
                  />
                  <ProductionBackCheckHint
                    check={productivityByLineItem.get(item.id) ?? null}
                    unit={item.unit}
                  />
                  <select
                    name="craftClassificationId"
                    defaultValue={item.craftClassificationId ?? ""}
                    title="Craft classification"
                    className="min-w-0 max-w-full rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
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
                    className="min-w-0 max-w-full rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none"
                  />
                  <SubmitButton
                    type="submit"
                    title="Save"
                    className="min-h-11 rounded-md bg-rail-hover px-2 py-1 text-xs font-medium text-ink hover:bg-lift mouse:min-h-9"
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
                    deleteClassName="rounded-md bg-red-950 px-2 py-1 text-xs font-medium text-danger hover:bg-red-900"
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
            </Disclosure>
          ))}
        </div>

        {/* Three ways to add lines, three buttons on one row: one yellow
            primary, the other two secondary. The AI draft box used to be
            the first thing on the tab, above every price. */}
        <div className="mt-4 flex flex-wrap items-start gap-3">
          <div className="w-full max-w-full sm:w-auto" data-tour="job-add-line-item">
            <CollapsedForm label="Add line item">
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
          <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm text-ink-label">
            Trade
            {/* Starts on the bid's own trade when it has one: left on "No
                trade tag", every typed line landed in the proposal's "Other
                work" (walk of 2026-10-30). Still changeable per line. */}
            <select
              name="tradeScope"
              defaultValue={job.bidProject?.tradeScope ?? ""}
              className="min-w-0 max-w-full rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
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
            className="inline-flex items-center justify-center rounded-md bg-rail-hover px-4 py-2 text-sm font-medium text-ink hover:bg-lift"
          >
            Add line item
          </SubmitButton>
        </ActionForm>
            </CollapsedForm>
          </div>
          {catalogEntries.length > 0 && (
            <div className="w-full max-w-full sm:w-auto">
              <CollapsedForm label="Add from catalog" tone="secondary">
          <ActionForm action={addLineItemFromCatalogWithId} className="flex flex-wrap items-end gap-3">
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
              className="inline-flex items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover"
            >
              Add from catalog
            </SubmitButton>
          </ActionForm>
              </CollapsedForm>
            </div>
          )}
          <div className="w-full max-w-full sm:w-auto">
            <CollapsedForm label="Draft line items from scope" tone="secondary">
              <DraftLineItemsForm jobId={job.id} initialScope={job.scope ?? ""} />
            </CollapsedForm>
          </div>
        </div>

        {/* START FROM A TEMPLATE — above "Add from catalog" because it
            is the bulk path and the catalog picker is the one-at-a-time
            one. The collision warning lives inside it, on screen before
            the press: applying a template APPENDS, so applying one twice
            doubles the estimate. */}
        {estimateTemplates.length > 0 && (
          <div className="mt-4">
            <ApplyEstimateTemplate
              jobId={job.id}
              jobTradeScope={dominantTradeScope(job.lineItems)}
              templates={estimateTemplates.map((template) => ({
                id: template.id,
                name: template.name,
                tradeScope: template.tradeScope,
                items: template.items.map((item) => ({
                  id: item.id,
                  description: item.description,
                  unit: item.unit,
                  defaultQuantity: item.defaultQuantity === null ? null : Number(item.defaultQuantity),
                  catalogEntryId: item.catalogEntryId,
                })),
              }))}
              existingLines={job.lineItems.map((item) => ({
                description: item.description,
                isDeleted: item.isDeleted,
              }))}
            />
          </div>
        )}

        <div className="mt-4">
        <TakeoffForm
          jobId={job.id}
          defaultWastePercent={bidDefaults?.defaultWastePercent?.toString() ?? null}
        />
        {/* The other way in. This form does the arithmetic from
            dimensions somebody already has; the Takeoff tab is where you
            get those dimensions off a drawing. */}
        <p className="mb-3 text-sm text-ink-muted">
          Working from a PDF instead?{" "}
          <Link href={hrefs.takeoff} className="text-link hover:text-link-hover">
            Measure off a plan
          </Link>{" "}
          — set the scale on a sheet and trace what you&rsquo;re taking off. Or{" "}
          {/* A REAL LINK to the full-screen workspace, so Cmd-click and
              right-click open it in a tab of its own. An estimator
              comparing a bid against a drawing wants both on screen, which
              a `window.open` or a `router.push` on a button cannot give
              them.

              KEPT THROUGH THE MERGE DELIBERATELY. The incoming rewrite of
              this section dropped it, and `e2e/specs/takeoff-workspace.spec.ts`
              clicks `open-takeoff-workspace` — so taking either side whole
              would have been wrong: theirs loses a tested route, mine loses
              the new line-item list. */}
          <Link
            href={hrefs.workspace}
            className="text-link hover:text-link-hover"
            data-estimate="open-takeoff-workspace"
          >
            open the takeoff workspace
          </Link>{" "}
          — the plan full screen, with the sheet list and quantities beside it.
        </p>
        </div>
      </section>
  );
}

/** The bid recap, with the checks that read the same cost base. */
export function EstimateRecap({
  data,
  canManageEstimating = false,
}: {
  data: JobEstimateData;
  /** Price-book writes answer to MANAGE_ESTIMATING (the actions assert it); the
   * "Update prices" control renders only for people they would not refuse. */
  canManageEstimating?: boolean;
}) {
  const { job, bidRecapRow, bidDefaults, bidRecapRates, bidRecapLines, missingIndirectLines, crossChecks, priceAnomalyReport, timeZone } = data;
  return (
    <>
      {/* BEFORE the recap, because the recap marks up the cost this
          refreshes. Estimate-stage only by construction: this whole branch
          is, and the action refuses a contracted job on its own. */}
      {canManageEstimating && <UpdatePricesPanel jobId={job.id} />}

      <section className="mb-10" data-tour="job-bid-recap">
        <h2 className="mb-1 text-lg font-semibold text-ink">Bid recap</h2>
        <p className="mb-3 text-sm text-ink-body">
          Built from each line&apos;s <span className="text-ink-label">budgeted cost</span>, not its price — markup
          is per cost type, so material and subcontracted work need not carry the same rate as your own crew. A line
          with no cost recorded is named below and marked up at nothing.
          {bidRecapRow == null && bidDefaults != null
            ? " These are your company defaults — saving them here keeps them on this job."
            : ""}
        </p>
        <BidRecapPanel
          jobId={job.id}
          lines={bidRecapLines}
          rates={bidRecapRates}
          ratesCollapsed
          applied={
            bidRecapRow?.appliedAt != null
              ? {
                  at: formatInstant(bidRecapRow.appliedAt, timeZone, "numeric"),
                  total: Number(bidRecapRow.appliedTotal ?? 0),
                }
              : null
          }
        />
        {/* BELOW THE RECAP, because it is a question about the cost base the
            recap marks up, and above the line list, because the answer is a
            new line. Nothing is checked or stored — `missingIndirects` is
            derived on every read. */}
        <MissingIndirects jobId={job.id} missing={missingIndirectLines} />
        {/* DIRECTLY BELOW `MissingIndirects`, because they are the same
            kind of finding read at two ranges: that one asks whether a
            FIXED LIST of general conditions is represented, this one asks
            whether a quantity that exists somewhere else reached a line.
            Both are muted, neither blocks, and putting them together is
            what stops a reader treating one as more serious than the
            other. */}
        <EstimateCrossChecks checks={crossChecks} />
        {/* BESIDE the cross-checks, because they answer adjacent halves of
            the same question before a bid goes out: #630 asks what was
            measured or carried and never priced, and this asks whether what
            WAS priced looks like what the work has cost. Both advisory,
            both silent when there is nothing to say. */}
        <PriceAnomalies report={priceAnomalyReport} />
      </section>
    </>
  );
}

/** The wall schedule: each run of wall by its type, length and height. */
export function EstimateWallSchedule({
  data,
  surface = "crm",
  canManageEstimating = false,
}: {
  data: JobEstimateData;
  surface?: Surface;
  /** Shows "Restore deleted lines" — see `EstimateRecap`. */
  canManageEstimating?: boolean;
}) {
  const { job, wallTypeInputs, wallRunViews, unpricedWallRuns } = data;
  const hrefs = surfaceHrefs(surface, job.id);
  return (
      <div className="mb-4" data-tour="job-wall-schedule">
        <Disclosure
          summary={
            <>
              <h2 className="inline text-lg font-semibold text-ink">Wall schedule</h2>
              <span className="ml-2 text-sm font-normal text-ink-muted">
                {wallRunViews.length} run{wallRunViews.length === 1 ? "" : "s"}
              </span>
            </>
          }
        >
          <WallSchedule
            jobId={job.id}
            types={wallTypeInputs}
            runs={wallRunViews}
            unpricedRunLabels={unpricedWallRuns}
            canRestore={canManageEstimating}
            wallTypesHref={hrefs.wallTypes}
          />
        </Disclosure>
      </div>
  );
}

/** Estimate versions: manual checkpoints of the lines. */
export function EstimateVersions({ data }: { data: JobEstimateData }) {
  const { job, timeZone } = data;
  const saveEstimateVersionWithId = saveEstimateVersion.bind(null, job.id);
  return (
      <Disclosure
        className="mb-4"
        summary={
          <>
            <h2 className="inline text-lg font-semibold text-ink">Estimate versions</h2>
            <span className="ml-2 text-sm font-normal text-ink-muted">
              {job.estimateVersions.length} saved
            </span>
          </>
        }
      >
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
            className="inline-flex items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover"
          >
            Save version
          </SubmitButton>
        </form>
      </Disclosure>
  );
}
