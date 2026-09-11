import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import {
  createLineItemCatalogEntry,
  updateCatalogDefaultsFromActuals,
} from "@/lib/actions";
import { catalogActuals, type JobStatusForActuals } from "@/lib/catalog-actuals";
import { CatalogImport } from "@/components/CatalogImport";
import { CatalogEntryRow } from "@/components/CatalogEntryRow";
import { TRADE_SCOPE_OPTIONS, tradeScopeLabel } from "@/lib/trade-scopes";
import { money } from "@/lib/money";
import { SubmitButton } from "@/components/SubmitButton";

type CatalogEntryWithLines = {
  id: string;
  defaultBudgetedUnitCost: unknown;
  jobLineItems: { quantity: unknown; costEntries: { amount: unknown }[]; job: { status: string } }[];
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

function ActualsLine({ entry }: { entry: CatalogEntryWithLines }) {
  const actuals = catalogActuals(
    entry.jobLineItems.map((line) => ({
      quantity: Number(line.quantity),
      actualCost: line.costEntries.reduce((sum, cost) => sum + Number(cost.amount), 0),
      hasCosts: line.costEntries.length > 0,
      // #105 finding 2: only a FINISHED job's booked cost is a real unit
      // cost — a job that is still running has quantity from day one but
      // only partial cost, which reads artificially low every time.
      jobStatus: line.job.status as JobStatusForActuals,
    })),
    entry.defaultBudgetedUnitCost != null ? Number(entry.defaultBudgetedUnitCost) : null,
  );

  if (actuals.actualUnitCost === null) {
    return (
      <p className="mt-1 text-xs text-ink-muted">
        {actuals.linesExcludedUnfinished > 0
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
            className="rounded-md border border-amber-300 px-2 py-1 text-xs text-tag-amber-ink hover:bg-tag-amber"
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

  const [entries, craftClassifications] = await Promise.all([
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
            costEntries: { select: { amount: true } },
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
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Line item catalog</h1>
      <p className="mb-6 text-sm text-ink-body">
        Reusable line items for estimating — add one here, or from an existing job&apos;s line item
        (&quot;Save as catalog item&quot;), then pull it into a new estimate with &quot;Add from
        catalog&quot; on any ESTIMATE-stage job.
      </p>

      <div className="mb-6">
        <CatalogImport existingDescriptions={entries.map((entry) => entry.description)} />
      </div>

      <section className="mb-8">
        {entries.length === 0 ? (
          <p className="text-ink-body">No catalog entries yet.</p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
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
                    {entry.defaultLaborHours != null && <> · {entry.defaultLaborHours.toString()} hrs</>}
                  </p>
                  <ActualsLine entry={entry} />
                </>
              </CatalogEntryRow>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-line-card bg-surface p-4">
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
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Default unit price
            <input
              name="defaultUnitPrice"
              placeholder="optional"
              className="w-32 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Default budgeted cost
            <input
              name="defaultBudgetedUnitCost"
              placeholder="optional"
              className="w-32 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-label">
            Default labor hrs
            <input
              name="defaultLaborHours"
              placeholder="optional"
              className="w-28 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
            />
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
            className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink-label hover:bg-yellow-500"
          >
            Add entry
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
