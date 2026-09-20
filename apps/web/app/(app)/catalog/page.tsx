import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import {
  createLineItemCatalogEntry,
  updateCatalogDefaultsFromActuals,
} from "@/lib/actions";
import { catalogActuals, catalogSourcedLine, type CatalogLineRow } from "@/lib/catalog-actuals";
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "@/lib/fringe-schedules-query";
import type { FringeRateScheduleInput } from "@/lib/labor-cost";
import { CatalogImport } from "@/components/CatalogImport";
import { CatalogEntryRow } from "@/components/CatalogEntryRow";
import { TRADE_SCOPE_OPTIONS, tradeScopeLabel } from "@/lib/trade-scopes";
import { money } from "@/lib/money";
import { SubmitButton } from "@/components/SubmitButton";
import { EmptyState } from "@/components/EmptyState";

type CatalogEntryWithLines = {
  id: string;
  defaultBudgetedUnitCost: unknown;
  jobLineItems: CatalogLineRow[];
};

/**
 * What this entry's work has actually cost, against what the entry says it
 * costs. The whole point of recording sourceCatalogEntryId: estimating tools
 * generally have no path for actuals to come back, and the two halves have
 * been sitting one table apart here the entire time.
 */
/**
 * Variance as a percentage, signed from the number actually shown.
 *
 * Taking the sign from the raw value printed "−0%" once actuals matched the
 * default — technically the sign of a tiny negative, but it reads as a
 * defect. The sign has to agree with the digits beside it, and a variance
 * that rounds away is better said in words than as a signed zero.
 */
function formatVariancePct(pct: number) {
  const rounded = Math.round(pct * 100);
  if (rounded === 0) return "on budget";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`;
}

function ActualsLine({
  entry,
  fringeSchedulesByCraft,
}: {
  entry: CatalogEntryWithLines;
  fringeSchedulesByCraft: ReadonlyMap<string, FringeRateScheduleInput[]>;
}) {
  // Built by the same function the WRITE uses (#287). A badge that disagreed
  // with the button under it would be worse than either being wrong alone.
  const actuals = catalogActuals(
    entry.jobLineItems.map((line) => catalogSourcedLine(line, fringeSchedulesByCraft)),
    entry.defaultBudgetedUnitCost != null ? Number(entry.defaultBudgetedUnitCost) : null,
  );

  if (actuals.actualUnitCost === null) {
    return (
      <p className="mt-1 text-xs text-ink-muted">
        {actuals.linesExcludedDoubleCountedLabor > 0
          ? `${actuals.linesExcludedDoubleCountedLabor} finished ${
              actuals.linesExcludedDoubleCountedLabor === 1 ? "line has" : "lines have"
            } both logged hours and a cost entry categorised Labor, so that time may be counted twice and what the work cost isn't clear. Recategorise the cost entry, or remove it if the hours already cover that labor.`
          : actuals.linesExcludedUnpricedHours > 0
          ? `${actuals.linesExcludedUnpricedHours} finished ${
              actuals.linesExcludedUnpricedHours === 1 ? "line has hours" : "lines have hours"
            } with no wage rate behind them, so what the work cost isn't known. Add a fringe rate schedule for that craft and dates to compare this entry's default against actuals.`
          : actuals.linesExcludedUnfinished > 0
            ? `${actuals.linesExcludedUnfinished} costed ${
                actuals.linesExcludedUnfinished === 1 ? "line uses" : "lines use"
              } this entry, but on a job that hasn't finished yet — nothing to compare its default against until one does.`
            : "No costed jobs have used this entry yet — nothing to compare its default against."}
      </p>
    );
  }

  const pct = actuals.variancePct;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <p className={`text-xs ${actuals.isFlagged ? "text-tag-amber-ink" : "text-ink-muted"}`}>
        Actual {money(actuals.actualUnitCost)}/unit across {actuals.linesWithCosts}{" "}
        {actuals.linesWithCosts === 1 ? "costed line" : "costed lines"}
        {actuals.defaultBudgetedUnitCost != null && (
          <>
            {" "}
            vs {money(actuals.defaultBudgetedUnitCost)} budgeted
            {pct != null && <> ({formatVariancePct(pct)})</>}
          </>
        )}
        {actuals.isFlagged && " — worth re-pricing"}
      </p>
      {/* #287: this figure is mostly crew time on a self-performed line, and
          an estimator who thinks it is materials will read it as impossibly
          cheap. Named rather than left to be inferred. */}
      {actuals.laborCost > 0 && (
        <p className="text-xs text-ink-muted">
          Includes {money(actuals.laborCost)} of burdened labor from logged hours.
        </p>
      )}
      {/* Hours nobody could price are left OUT of the figure above, so the
          sample is smaller than the job history looks. Saying so is the
          difference between a number and a number you can act on. */}
      {actuals.linesExcludedUnpricedHours > 0 && (
        <p className="text-xs text-tag-amber-ink">
          {actuals.linesExcludedUnpricedHours} further finished{" "}
          {actuals.linesExcludedUnpricedHours === 1 ? "line is" : "lines are"} left out — their
          hours have no wage rate behind them.
        </p>
      )}
      {/* The third exclusion, and the quickest to fix: the line has logged
          hours AND a cost entry categorised Labor, so its labor may be in the
          figure twice. Learning from it would bias this template HIGH, which
          loses work silently — see hasAmbiguousLaborCost. */}
      {actuals.linesExcludedDoubleCountedLabor > 0 && (
        <p className="text-xs text-tag-amber-ink">
          {actuals.linesExcludedDoubleCountedLabor} further finished{" "}
          {actuals.linesExcludedDoubleCountedLabor === 1 ? "line is" : "lines are"} left out — they
          have both logged hours and a cost entry categorised Labor, so that time may be counted
          twice.
        </p>
      )}
      {actuals.isFlagged && (
        <form
          action={updateCatalogDefaultsFromActuals.bind(null, entry.id)}
          className="flex flex-wrap items-center gap-2"
        >
          {/* No hidden input carrying the figure any more (#105 finding 3)
              — the server re-derives it from the line items, so this form
              sends nothing but the margin checkbox. What's shown above is
              only ever a preview of what the server will work out itself. */}
          <label className="flex items-center gap-1 text-xs text-ink-body">
            <input type="checkbox" name="alsoUpdatePrice" className="accent-yellow-500" />
            also move the sale price, holding margin
          </label>
          <SubmitButton
            type="submit"
            className="rounded-md border border-amber-700 px-2 py-1 text-xs text-tag-amber-ink hover:bg-tag-amber"
          >
            Update default from actuals
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

export default async function CatalogPage() {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;

  const [entries, craftClassifications, fringeSchedulesByCraft] = await Promise.all([
    prisma.lineItemCatalogEntry.findMany({
      where: { companyId: company.id },
      orderBy: { description: "asc" },
      include: {
        craftClassification: { include: { unionLocal: true } },
        // How work priced from this template actually costed. Read-only —
        // the entry is a template and nothing here writes back to these rows.
        jobLineItems: {
          where: { isDeleted: false },
          select: {
            quantity: true,
            // `category` is load-bearing, not decoration: it is the only thing
            // that can tell a LABOR cost entry sitting beside logged hours from
            // a material one. Without it every line reads as unambiguous and
            // `hasAmbiguousLaborCost` can never fire.
            costEntries: { select: { amount: true, category: true } },
            // #287: on a self-performed line the crew's hours ARE the cost,
            // and a line with no cost entries at all was not merely
            // understated here — it dropped out of the sample entirely.
            timeEntries: { select: TIME_ENTRY_COST_SELECT },
            job: { select: { status: true } },
          },
        },
      },
    }),
    prisma.craftClassification.findMany({
      where: { companyId: company.id },
      include: { unionLocal: true },
      orderBy: { name: "asc" },
    }),
    loadFringeSchedulesByCraft(company.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Line item catalog</h1>
      <p className="mb-6 text-sm text-ink-body">
        Reusable line items for estimating — add one here, or from an existing job&apos;s line item
        (&quot;Save as catalog item&quot;), then pull it into a new estimate with &quot;Add from
        catalog&quot; on any ESTIMATE-stage job.
      </p>

      <div className="mb-6" data-tour="catalog-import">
        <CatalogImport existingDescriptions={entries.map((entry) => entry.description)} />
      </div>

      <section className="mb-8">
        {entries.length === 0 ? (
          <EmptyState
            data-tour="catalog-empty"
            title="No catalog entries yet"
            purpose={
              <p>
                Your price book: the things you put on every estimate — a sheet of drywall hung and
                finished, a day of demo, a door installed — with the unit and what you charge. Save
                them once and pull them into any estimate in two clicks instead of retyping prices.
              </p>
            }
            actions={[
              { label: "Add a catalog entry", opens: "catalog-add" },
              { label: "Import a price list", opens: "catalog-import" },
            ]}
            sources={
              <p>
                Entries you add below, a price list pasted from a spreadsheet, and any line on a job
                you save with &ldquo;Save as catalog item&rdquo;.
              </p>
            }
            example={{
              rows: [
                { title: "Hang and finish 1/2\" drywall", detail: "sq ft · $2.10/unit", meta: "used on 6 jobs" },
                { title: "Interior door, prehung, installed", detail: "each · $385.00/unit", meta: "used on 3 jobs" },
                { title: "Demo and haul-away", detail: "day · $950.00/unit", meta: "used on 4 jobs" },
              ],
            }}
          />
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="catalog-list">
            {entries.map((entry) => (
              <CatalogEntryRow
                key={entry.id}
                entryId={entry.id}
                linkedLineCount={entry.jobLineItems.length}
              >
                <>
                  <p className="font-medium text-ink">{entry.description}</p>
                  <p className="text-sm text-ink-body">
                    {entry.unit && <>{entry.unit} · </>}
                    {entry.defaultUnitPrice != null && <>{money(Number(entry.defaultUnitPrice))}/unit · </>}
                    {entry.defaultBudgetedUnitCost != null && (
                      <>{money(Number(entry.defaultBudgetedUnitCost))} cost · </>
                    )}
                    {tradeScopeLabel(entry.tradeScope) ?? "No trade tag"}
                    {entry.craftClassification && (
                      <>
                        {" "}
                        · {entry.craftClassification.unionLocal.parentInternational}{" "}
                        {entry.craftClassification.unionLocal.localNumber} — {entry.craftClassification.name}
                      </>
                    )}
                    {/* "hrs/line", never a bare "hrs", and deliberately the same
                        shape as the "/unit" on the price two lines up. The number
                        is copied onto an added line UNCHANGED — see
                        `addCatalogLine` and `catalog-line.test.ts`. A reader who
                        sees "$2.85/unit · 8 hrs" beside each other has no way to
                        tell that one of them scales with quantity and the other
                        does not, which is exactly how an estimator read it. */}
                    {entry.defaultLaborHours != null && (
                      <> · {entry.defaultLaborHours.toString()} hrs/line</>
                    )}
                  </p>
                  <ActualsLine entry={entry} fringeSchedulesByCraft={fringeSchedulesByCraft} />
                </>
              </CatalogEntryRow>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-line-card bg-surface p-4" data-tour="catalog-add">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Add a catalog entry</h2>
        <form action={createLineItemCatalogEntry} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-sm text-ink-label">
            Description
            <input
              name="description"
              required
              className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Unit
            <input
              name="unit"
              placeholder="e.g. sq ft"
              className="w-28 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
            />
          </label>
          {/* THESE THREE HAD NO `type` AT ALL, so they defaulted to text and
              fed `nullableDecimalFromForm`, which refuses anything
              `Number()` cannot read. Type "1,200" or "$2.85" — the two ways
              a person actually writes a price — and the action THREW, which
              on this form is the worst case in the app: it is a plain
              `<form action={…}>` with no client error handling, so the throw
              reaches the error boundary, the page is replaced, and every
              field typed alongside it is gone. The message would have been
              redacted anyway.

              `type="number"` makes the browser refuse the comma and the
              dollar sign before anything is submitted; `step="0.01"` is what
              stops it ALSO rejecting 2.85 (the default step is 1);
              `inputMode="decimal"` opens a phone straight on a keypad with a
              decimal point, which `type="number"` alone does not guarantee
              on Android — the same pairing SafetyIncidentFields documents.

              Browser validation is not the server check, and the server
              check here is still a throw: `createLineItemCatalogEntry` lives
              in `lib/actions/estimating.ts`, which is the other lane. Its
              conversion is reported, not done here. */}
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Default unit price
            <input
              name="defaultUnitPrice"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="optional"
              className="w-32 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Default budgeted cost
            <input
              name="defaultBudgetedUnitCost"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="optional"
              className="w-32 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
            />
          </label>
          {/* The label states the ARITHMETIC, not the units, because the
              arithmetic is what nobody could tell. `addCatalogLine` copies this
              value onto the new line as-is while unit price and budgeted cost
              are both multiplied by quantity downstream — so a 6 SF line and a
              600 SF line built from this entry carry identical hours. Whether
              that is what anyone WANTED is an open question recorded in
              changelog.d/cyrus-catalog-labor-hours-meaning.md; until it is
              answered the field says what it does. */}
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Default labor hrs — whole line
            <input
              name="defaultLaborHours"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="optional"
              aria-describedby="defaultLaborHours-help"
              className="w-28 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
            />
            <span id="defaultLaborHours-help" className="max-w-[14rem] text-xs text-ink-body">
              Copied onto the line unchanged — a 6 SF line and a 600 SF line both
              get this many hours. Not a per-unit rate.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Trade
            <select
              name="tradeScope"
              defaultValue=""
              className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
            >
              <option value="">No trade tag</option>
              {TRADE_SCOPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {craftClassifications.length > 0 && (
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Craft
              <select
                name="craftClassificationId"
                defaultValue=""
                className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
              >
                <option value="">No craft tag</option>
                {craftClassifications.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.unionLocal.parentInternational} {c.unionLocal.localNumber} — {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <SubmitButton
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
          >
            Add entry
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
