import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { createLineItemCatalogEntry, deleteLineItemCatalogEntry } from "@/lib/actions";
import { money } from "@/lib/money";

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

export default async function CatalogPage() {
  const { company } = await requireCompanyContext();

  const [entries, craftClassifications] = await Promise.all([
    prisma.lineItemCatalogEntry.findMany({
      where: { companyId: company.id },
      orderBy: { description: "asc" },
      include: { craftClassification: { include: { unionLocal: true } } },
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
                </div>
                <form action={deleteLineItemCatalogEntry.bind(null, entry.id)}>
                  <button type="submit" className="text-xs text-red-400 hover:underline">
                    Delete
                  </button>
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
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Add entry
          </button>
        </form>
      </section>
    </div>
  );
}
