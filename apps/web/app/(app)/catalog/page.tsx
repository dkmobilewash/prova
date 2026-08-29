import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import {
  createLineItemCatalogEntry,
  deleteLineItemCatalogEntry,
  updateCatalogDefaultsFromActuals,
} from "@/lib/actions";
import { catalogActuals } from "@/lib/catalog-actuals";
import { money } from "@/lib/money";
import { SubmitButton } from "@/components/SubmitButton";

const TRADE_SCOPE_OPTIONS = [
  { value: "METAL_FRAMING_DRYWALL", label: "Metal framing / drywall" },
  { value: "LATH_PLASTER", label: "Lath & plaster" },
  { value: "EIFS", label: "EIFS" },
  { value: "ACOUSTICAL_CEILINGS", label: "Acoustical ceilings" },
  { value: "FIREPROOFING", label: "Fireproofing" },
] as const;

function labelFor(value: string | null) {
  return TRADE_SCOPE_OPTIONS.find((t) => t.value === value)?.label ?? null;
}

type CatalogEntryWithLines = {
  id: string;
  defaultBudgetedUnitCost: unknown;
  jobLineItems: { quantity: unknown; costEntries: { amount: unknown }[] }[];
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
    })),
    entry.defaultBudgetedUnitCost != null ? Number(entry.defaultBudgetedUnitCost) : null,
  );

  if (actuals.actualUnitCost === null) {
    return (
      <p className="mt-1 text-xs text-slate-500">
        No costed jobs have used this entry yet — nothing to compare its default against.
      </p>
    );
  }

  const pct = actuals.variancePct;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <p className={`text-xs ${actuals.isFlagged ? "text-amber-300" : "text-slate-500"}`}>
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
          <input type="hidden" name="actualUnitCost" value={actuals.actualUnitCost.toFixed(2)} />
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input type="checkbox" name="alsoUpdatePrice" className="accent-blue-500" />
            also move the sale price, holding margin
          </label>
          <SubmitButton
            type="submit"
            className="rounded-md border border-amber-700 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950"
          >
            Update default from actuals
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

export default async function CatalogPage() {
  const { company } = await requireCompanyContext();

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
          select: { quantity: true, costEntries: { select: { amount: true } } },
        },
      },
    }),
    prisma.craftClassification.findMany({
      where: { unionLocal: { companyAgreements: { some: { companyId: company.id } } } },
      include: { unionLocal: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Line item catalog</h1>
      <p className="mb-6 text-sm text-slate-400">
        Reusable line items for estimating — add one here, or from an existing job&apos;s line item
        (&quot;Save as catalog item&quot;), then pull it into a new estimate with &quot;Add from
        catalog&quot; on any ESTIMATE-stage job.
      </p>

      <section className="mb-8">
        {entries.length === 0 ? (
          <p className="text-slate-400">No catalog entries yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium text-slate-100">{entry.description}</p>
                  <p className="text-sm text-slate-400">
                    {entry.unit && <>{entry.unit} · </>}
                    {entry.defaultUnitPrice != null && <>{money(Number(entry.defaultUnitPrice))}/unit · </>}
                    {entry.defaultBudgetedUnitCost != null && (
                      <>{money(Number(entry.defaultBudgetedUnitCost))} cost · </>
                    )}
                    {labelFor(entry.tradeScope) ?? "No trade tag"}
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
                </div>
                <form action={deleteLineItemCatalogEntry.bind(null, entry.id)}>
                  <SubmitButton type="submit" className="text-xs text-red-400 hover:underline">
                    Delete
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Add a catalog entry</h2>
        <form action={createLineItemCatalogEntry} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-sm text-slate-300">
            Description
            <input
              name="description"
              required
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Unit
            <input
              name="unit"
              placeholder="e.g. sq ft"
              className="w-28 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Default unit price
            <input
              name="defaultUnitPrice"
              placeholder="optional"
              className="w-32 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Default budgeted cost
            <input
              name="defaultBudgetedUnitCost"
              placeholder="optional"
              className="w-32 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Default labor hrs
            <input
              name="defaultLaborHours"
              placeholder="optional"
              className="w-28 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Trade
            <select
              name="tradeScope"
              defaultValue=""
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
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
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Craft
              <select
                name="craftClassificationId"
                defaultValue=""
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
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
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Add entry
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
