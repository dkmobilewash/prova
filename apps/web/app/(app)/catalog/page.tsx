import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { createLineItemCatalogEntry, updateCatalogDefaultsFromActuals } from "@/lib/actions";
import { catalogActuals, catalogSourcedLine, type CatalogLineRow } from "@/lib/catalog-actuals";
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "@/lib/fringe-schedules-query";
import { loadEmployerBurdenRates } from "@/lib/employer-burden-query";
import type { FringeRateScheduleInput } from "@/lib/labor-cost";
import type { EmployerBurdenRates } from "@/lib/labor-job-cost";
import { employerBurdenPercentOnDay, laborCostBasisLabel } from "@/lib/employer-burden";
import { serverToday } from "@/lib/serverToday";
import { CatalogImport } from "@/components/CatalogImport";
import { CatalogEntryRow } from "@/components/CatalogEntryRow";
import { TRADE_SCOPE_OPTIONS, tradeScopeLabel } from "@/lib/trade-scopes";
import { money } from "@/lib/money";
import { SubmitButton } from "@/components/SubmitButton";
import { EmptyState } from "@/components/EmptyState";
import { ActionForm } from "@/components/ActionForm";

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
  employerBurdenRates,
  isOwner,
}: {
  entry: CatalogEntryWithLines;
  fringeSchedulesByCraft: ReadonlyMap<string, FringeRateScheduleInput[]>;
  /* The company's employer-burden rates, in the same shape the WRITE
     (`updateCatalogDefaultsFromActuals`) reads them. Handed down rather than
     loaded here for the same reason the schedules are: the badge and the
     button that banks it must be built from one set of inputs. */
  employerBurdenRates: EmployerBurdenRates;
  /* Whether to render the re-price CONTROL at all. Not a security boundary
     — `updateCatalogDefaultsFromActuals` refuses a non-owner itself — but
     the badge above it stays visible either way, because "worth re-pricing"
     is information an estimator should have even when the button is the
     owner's. Same split IntakeForwardBox documents. */
  isOwner: boolean;
}) {
  // Built by the same function the WRITE uses (#287). A badge that disagreed
  // with the button under it would be worse than either being wrong alone.
  const actuals = catalogActuals(
    entry.jobLineItems.map((line) => catalogSourcedLine(line, fringeSchedulesByCraft, employerBurdenRates)),
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
          Includes {money(actuals.laborCost)} of labor from logged hours —{" "}
          {laborCostBasisLabel(employerBurdenPercentOnDay(employerBurdenRates, serverToday()))}.
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
      {/* Still no hidden input carrying the figure (#105 finding 3) — the
          server re-derives it from the line items and this form sends
          nothing but the margin checkbox. What is shown above is only ever
          a preview of what the server will work out itself.

          `<ActionForm>`, not `<form action={…}>`, and this is the control
          that most needed it. `updateCatalogDefaultsFromActuals` threw
          every refusal it had, and production redacts a thrown Server
          Action message to a digest — so the two outcomes were "the price
          changed" and a blank error page. The refusals here are the useful
          ones: `repriceDecision` re-checks the flag and the sample that
          made this button appear, because the page may be minutes old, and
          it names what to do — add a fringe rate schedule covering the
          craft and dates those hours were worked, or recategorise the cost
          entry sitting beside logged hours. An owner met those on an
          ordinary race and saw the digest. */}
      {actuals.isFlagged && isOwner && (
        <ActionForm
          action={updateCatalogDefaultsFromActuals.bind(null, entry.id)}
          className="flex flex-wrap items-center gap-2"
          errorClassName="w-full text-xs text-tag-rose-ink"
        >
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
        </ActionForm>
      )}
    </div>
  );
}

export default async function CatalogPage() {
  const { context, allowed } = await requireCapability("MANAGE_ESTIMATING");
  if (!allowed) return <NoAccess capability="MANAGE_ESTIMATING" />;
  const { company } = context;
  /* THE PAGE ADMITS MORE PEOPLE THAN ITS TWO OWNER-ONLY CONTROLS DO, and
     that gap is the whole defect. `/catalog` demands MANAGE_ESTIMATING and
     ESTIMATOR holds it (lib/permissions.ts) — by design; pricing work is
     what an estimator does. But the price-list import and the re-price
     button are owner-only in the actions behind them, and neither was
     gated here. An estimator could paste two hundred rows, click, and get
     the error boundary with the paste inside it.

     `context.role === "OWNER"` rather than a capability, deliberately:
     these two are administration, not estimating, and no job function
     grants or withholds it (see the UserRole/JobFunction note at the top of
     lib/permissions.ts). Cosmetic, not a boundary — both actions refuse a
     non-owner themselves. */
  const isOwner = context.role === "OWNER";

  const [entries, craftClassifications, fringeSchedulesByCraft, employerBurdenRates] = await Promise.all([
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
    loadEmployerBurdenRates(company.id),
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
        <CatalogImport existingDescriptions={entries.map((entry) => entry.description)} canImport={isOwner} />
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
                  <ActualsLine
                    entry={entry}
                    fringeSchedulesByCraft={fringeSchedulesByCraft}
                    employerBurdenRates={employerBurdenRates}
                    isOwner={isOwner}
                  />
                </>
              </CatalogEntryRow>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-line-card bg-surface p-4" data-tour="catalog-add">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Add a catalog entry</h2>
        <ActionForm action={createLineItemCatalogEntry} className="flex flex-wrap items-end gap-3">
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
              fed `nullableDecimalFromForm`, which refused anything `Number()`
              could not read. Type "1,200" or "$2.85" — the two ways a person
              actually writes a price — and the action THREW, which on this
              form was the worst case in the app: a plain `<form action={…}>`
              with no client error handling, so the throw reached the error
              boundary, the page was replaced, and every field typed alongside
              it went with it. The message would have been redacted anyway.

              THE FIX THAT USED TO BE DESCRIBED HERE WAS `type="number"`, and
              this paragraph recommended it in as many words: "makes the
              browser refuse the comma and the dollar sign before anything is
              submitted". That sentence is true and it is the PROBLEM, not the
              solution — measured in real Chromium 2026-09-21, setting such a
              field's value to `2,800` submits an EMPTY STRING, and on a
              NULLABLE field like these three an empty string is "not set", so
              the price silently vanished with no error at all. Firefox
              submits "" for anything it dislikes. Refusing input at the box
              is only safe when the box refuses visibly, and it does not.

              So: `type="text"` with `inputMode="decimal"` — what was typed
              stays on screen and a phone still opens on a keypad — and the
              server does the deciding, tolerantly, in lib/numeric-input.ts.
              `1,200` and `$2.85` both save now. `step` went with the type;
              there is nothing left for it to fix.

              `createLineItemCatalogEntry` returns its refusals rather than
              throwing them, and this form posts through `<ActionForm>`, so a
              figure that genuinely is not a number arrives as a sentence
              under the fields that are still filled in. */}
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Default unit price
            <input
              name="defaultUnitPrice"
              type="text"
              inputMode="decimal"
              placeholder="optional"
              className="w-32 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Default budgeted cost
            <input
              name="defaultBudgetedUnitCost"
              type="text"
              inputMode="decimal"
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
              type="text"
              inputMode="decimal"
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
        </ActionForm>
      </section>
    </div>
  );
}
