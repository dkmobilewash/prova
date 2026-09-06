import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { catalogActuals, type JobStatusForActuals } from "@/lib/catalog-actuals";
import { CatalogImport } from "@/components/CatalogImport";
import { CatalogEntryRow } from "@/components/CatalogEntryRow";
import { CatalogEntryForm } from "@/components/CatalogEntryForm";
import { CatalogRepriceForm } from "@/components/CatalogRepriceForm";
import { tradeScopeLabel } from "@/lib/trade-scopes";
import { money } from "@/lib/money";

type CatalogEntryWithLines = {
  id: string;
  defaultBudgetedUnitCost: unknown;
  jobLineItems: {
    quantity: unknown;
    costEntries: { amount: unknown }[];
    job: { status: string };
  }[];
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
      // Load-bearing: cost arrives over the life of a job while quantity is
      // the whole scope from day one, so a line that is only part built
      // reports a fraction of its unit cost. See FINISHED_JOB_STATUSES.
      jobStatus: line.job.status as JobStatusForActuals,
    })),
    entry.defaultBudgetedUnitCost != null ? Number(entry.defaultBudgetedUnitCost) : null,
  );

  // What was left out, said out loud. "Nothing has used this entry" and
  // "things have used it but none of them has finished" are different
  // facts, and only one of them means there is nothing to do.
  const unfinishedNote =
    actuals.linesExcludedUnfinished > 0 ? (
      <>
        {" "}
        {actuals.linesExcludedUnfinished} costed{" "}
        {actuals.linesExcludedUnfinished === 1 ? "line is" : "lines are"} on a job that hasn&apos;t
        finished and {actuals.linesExcludedUnfinished === 1 ? "is" : "are"} not counted — cost
        booked part-way through a job is not a unit cost.
      </>
    ) : null;

  if (actuals.actualUnitCost === null) {
    return (
      <p className="mt-1 text-xs text-slate-500">
        {actuals.linesExcludedUnfinished > 0
          ? "No FINISHED job has used this entry yet, so there is nothing to compare its default against."
          : "No costed jobs have used this entry yet — nothing to compare its default against."}
        {unfinishedNote}
      </p>
    );
  }

  const pct = actuals.variancePct;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <p className={`text-xs ${actuals.isFlagged ? "text-amber-300" : "text-slate-500"}`}>
        Actual {money(actuals.actualUnitCost)}/unit across {actuals.linesWithCosts} finished{" "}
        {actuals.linesWithCosts === 1 ? "costed line" : "costed lines"}
        {actuals.defaultBudgetedUnitCost != null && (
          <>
            {" "}
            vs {money(actuals.defaultBudgetedUnitCost)} budgeted
            {pct != null && <> ({formatVariancePct(pct)})</>}
          </>
        )}
        {actuals.isFlagged && " — worth re-pricing"}
        {unfinishedNote}
      </p>
      {actuals.isFlagged && (
        <CatalogRepriceForm
          entryId={entry.id}
          previewUnitCost={money(actuals.actualUnitCost)}
        />
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
            // Whether the work is finished. Without it, cost booked
            // part-way through a job divides by the full scope and reports
            // a fraction of the true unit cost — biased DOWN, every time.
            job: { select: { status: true } },
          },
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

      <div className="mb-6">
        <CatalogImport existingDescriptions={entries.map((entry) => entry.description)} />
      </div>

      <section className="mb-8">
        {entries.length === 0 ? (
          <p className="text-slate-400">No catalog entries yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {entries.map((entry) => (
              <CatalogEntryRow
                key={entry.id}
                entryId={entry.id}
                linkedLineCount={entry.jobLineItems.length}
              >
                <>
                  <p className="font-medium text-slate-100">{entry.description}</p>
                  <p className="text-sm text-slate-400">
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

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Add a catalog entry</h2>
        <CatalogEntryForm
          craftOptions={craftClassifications.map((c) => ({
            id: c.id,
            label: `${c.unionLocal.parentInternational} ${c.unionLocal.localNumber} — ${c.name}`,
          }))}
        />
      </section>
    </div>
  );
}
