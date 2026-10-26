import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { priceCatalogEntryFromQuotes, updateCatalogDefaultsFromActuals } from "@/lib/actions";
import { quotePriceDecision } from "@/lib/catalog-quote-price";
import type { QuoteData } from "@/components/vendorPricing";
import { todayInZone } from "@/lib/viewer-timezone";
import { viewerTimeZone } from "@/lib/viewerToday";
import { catalogActuals, catalogSourcedLine, type CatalogLineRow } from "@/lib/catalog-actuals";
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "@/lib/fringe-schedules-query";
import { loadEmployerBurdenRates } from "@/lib/employer-burden-query";
import type { FringeRateScheduleInput } from "@/lib/labor-cost";
import type { EmployerBurdenRates } from "@/lib/labor-job-cost";
import { employerBurdenPercentOnDay, laborCostBasisLabel } from "@/lib/employer-burden";
import { serverToday } from "@/lib/serverToday";
import { CatalogImport } from "@/components/CatalogImport";
import { EstimateTemplates, type TemplateRow } from "@/components/EstimateTemplates";
import { CatalogEntryAddForm, CatalogEntryItem, CatalogListHeader } from "@/components/CatalogParts";
import { money } from "@/lib/money";
import { SubmitButton } from "@/components/SubmitButton";
import { EmptyState } from "@/components/EmptyState";
import { ActionForm } from "@/components/ActionForm";
import { CollapsedForm } from "@/components/CollapsedForm";
import { Disclosure } from "@/components/Disclosure";

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

/** What a vendor will actually sell this item for, and the button that makes
 * it the default cost.
 *
 * Built by the SAME `quotePriceDecision` the write calls, for the reason the
 * actuals badge above gives: a sentence that disagreed with the button under
 * it would be worse than either being wrong alone. When the decision refuses,
 * its sentence is what renders — which is how a reader learns that the only
 * live quote is priced by the MSF while their catalog item is measured in SF.
 */
function QuoteLine({
  entry,
  quotes,
  today,
  isOwner,
}: {
  entry: { id: string; unit: string | null; defaultBudgetedUnitCost: unknown; defaultUnitPrice: unknown };
  quotes: QuoteData[];
  today: string;
  isOwner: boolean;
}) {
  // Nothing recorded at all is the ordinary state of a new account, and an
  // empty row per catalog item would be noise rather than news.
  if (quotes.length === 0) return null;

  const decision = quotePriceDecision(
    {
      unit: entry.unit,
      defaultBudgetedUnitCost: entry.defaultBudgetedUnitCost != null ? Number(entry.defaultBudgetedUnitCost) : null,
      defaultUnitPrice: entry.defaultUnitPrice != null ? Number(entry.defaultUnitPrice) : null,
    },
    quotes,
    today,
    false,
  );

  if (!decision.ok) {
    return <p className="mt-1 text-xs text-ink-muted">{decision.error}</p>;
  }

  const { offer } = decision;
  return (
    <div className="mt-1 flex flex-col gap-1">
      <p className="text-xs text-ink-body">
        Cheapest live quote {money(offer.unitPrice)}
        {offer.unitless ? " (no unit given)" : ` per ${offer.unit}`} from {offer.vendorName} —{" "}
        {offer.sourceLabel.toLowerCase()}, quoted {offer.quotedOn}.{" "}
        {offer.currentCost != null
          ? `Your default cost is ${money(offer.currentCost)}.`
          : "This item has no default cost yet."}
      </p>
      {isOwner && (
        <ActionForm
          action={priceCatalogEntryFromQuotes.bind(null, entry.id)}
          className="flex flex-wrap items-center gap-2"
          errorClassName="w-full text-xs text-tag-rose-ink"
        >
          <label className="flex items-center gap-1 text-xs text-ink-body">
            <input type="checkbox" name="alsoUpdatePrice" className="accent-yellow-500" />
            also move the sale price, holding margin
          </label>
          <SubmitButton
            type="submit"
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-rail-hover"
          >
            Set default cost from this quote
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

  // The viewer's own calendar day: whether a quote has expired "today" is a
  // question about where the person reading it is standing.
  const today = todayInZone(await viewerTimeZone());

  const [entries, craftClassifications, fringeSchedulesByCraft, employerBurdenRates, estimateTemplates] = await Promise.all([
    prisma.lineItemCatalogEntry.findMany({
      where: { companyId: company.id },
      orderBy: { description: "asc" },
      include: {
        craftClassification: { include: { unionLocal: true } },
        // What vendors have quoted for this item. A cross-lane READ of the
        // vendors' own records (operations.prisma is Cyrus's file) and never
        // a write: the price only moves when an owner presses the button
        // below, and nothing here ever reaches a job.
        priceQuotes: {
          include: { vendor: { select: { name: true } } },
          orderBy: { quotedOn: "desc" },
        },
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
    prisma.estimateTemplate.findMany({
      where: { companyId: company.id },
      orderBy: { name: "asc" },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          include: { catalogEntry: { select: { description: true } } },
        },
      },
    }),
  ]);

  return (
    <PageShell width="working">
      <PageHeader
        route="/catalog"
        subtitle={
          <>
            Reusable line items for estimating — add one here, or save one from a job&apos;s line
            (&quot;Save as catalog item&quot;), then pull it into an estimate with &quot;Add from
            catalog&quot;.
          </>
        }
      />

      {/* Add and Import lead the page (density audit #24 — Add sat under
          the whole list). Both are the same collapsed controls as before. */}
      <div className="mb-6 flex flex-wrap items-start gap-3">
      <section data-tour="catalog-add">
        <CollapsedForm label="Add a catalog entry">
            <CatalogEntryAddForm craftClassifications={craftClassifications} />
        </CollapsedForm>
      </section>
        <div data-tour="catalog-import">
          <CatalogImport existingDescriptions={entries.map((entry) => entry.description)} canImport={isOwner} />
        </div>
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
          <>
          <CatalogListHeader />
          <ul className="divide-y divide-line-row rounded-xl border border-line-card bg-surface" data-tour="catalog-list">
            {entries.map((entry) => (
              <CatalogEntryItem key={entry.id} entry={entry} linkedLineCount={entry.jobLineItems.length}>
                  <ActualsLine
                    entry={entry}
                    fringeSchedulesByCraft={fringeSchedulesByCraft}
                    employerBurdenRates={employerBurdenRates}
                    isOwner={isOwner}
                  />
                  <QuoteLine
                    entry={entry}
                    today={today}
                    isOwner={isOwner}
                    quotes={entry.priceQuotes.map((quote) => ({
                      id: quote.id,
                      vendorId: quote.vendorId,
                      vendorName: quote.vendor.name,
                      catalogEntryId: quote.catalogEntryId,
                      description: quote.description,
                      unit: quote.unit,
                      unitPrice: Number(quote.unitPrice),
                      quotedOn: quote.quotedOn.toISOString().slice(0, 10),
                      validUntil: quote.validUntil ? quote.validUntil.toISOString().slice(0, 10) : null,
                      source: quote.source,
                      notes: quote.notes,
                    }))}
                  />
              </CatalogEntryItem>
            ))}
          </ul>
          </>
        )}
      </section>

      {/* Templates are a set of pointers INTO these entries. They used to
          sit above the price book, explainer and all; they are one click
          away now (density audit #24). Same component, same props. */}
      <Disclosure summary={`Estimate templates · ${estimateTemplates.length}`} id="templates">
      <EstimateTemplates
        templates={estimateTemplates.map(
          (template): TemplateRow => ({
            id: template.id,
            name: template.name,
            tradeScope: template.tradeScope,
            description: template.description,
            items: template.items.map((item) => ({
              id: item.id,
              description: item.description,
              unit: item.unit,
              defaultQuantity: item.defaultQuantity === null ? null : Number(item.defaultQuantity),
              catalogEntryId: item.catalogEntryId,
              catalogEntryDescription: item.catalogEntry?.description ?? null,
            })),
          }),
        )}
        catalogEntries={entries.map((entry) => ({
          id: entry.id,
          description: entry.description,
          unit: entry.unit,
        }))}
      />
      </Disclosure>
    </PageShell>
  );
}
