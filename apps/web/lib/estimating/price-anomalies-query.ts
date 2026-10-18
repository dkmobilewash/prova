import { prisma } from "@prova/db";
import { catalogActuals, catalogSourcedLine } from "@/lib/catalog-actuals";
// `cache`d loaders, and the SAME ones the catalog page uses — a second copy
// of the fringe/burden read would price the same hours differently.
import { loadFringeSchedulesByCraft, TIME_ENTRY_COST_SELECT } from "@/lib/fringe-schedules-query";
import { loadEmployerBurdenRates } from "@/lib/employer-burden-query";
import { priceAnomalies, type AnomalyHistory, type AnomalyLine, type PriceAnomalyReport } from "./price-anomalies";

/**
 * Each of a job's lines paired with what that work has actually cost, then
 * judged.
 *
 * ── IT REUSES `catalogActuals` AND DOES NOT RE-DERIVE ANYTHING ──
 *
 * "What has this work cost us" is already answered, carefully, in
 * `lib/catalog-actuals.ts`: finished jobs only, hours that could all be priced,
 * labor that is not double-counted, three exclusions reported separately. That
 * is a lot of judgement to get right and `/catalog` already shows its answer.
 * A second computation here would be a second authority, and the day the two
 * disagreed the estimate screen and the catalog screen would each be telling an
 * estimator something true about a different number.
 *
 * So this file is a join and nothing else. Every figure comes back out of
 * `catalogActuals`.
 *
 * ── THE JOIN THAT MATTERS ──
 *
 * A line's history is not on its own job. `JobLineItem.sourceCatalogEntryId`
 * points at the catalog entry it was created from, and that entry's history is
 * EVERY line made from it across EVERY job — which is why the second query
 * reads `jobLineItems` on the entry rather than anything scoped to this job.
 * Getting that wrong in the narrow direction would silently compare the bid to
 * itself.
 *
 * It is scoped by company at both ends anyway: the job by `companyId`, and the
 * catalog entries by `companyId` too. A catalog entry is company data and so is
 * the cost history hanging off it.
 */
export async function loadPriceAnomalies(jobId: string, companyId: string): Promise<PriceAnomalyReport> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: {
      lineItems: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          description: true,
          unit: true,
          unitPrice: true,
          budgetedUnitCost: true,
          sourceCatalogEntryId: true,
        },
      },
    },
  });
  if (!job) return { anomalies: [], checked: 0, unchecked: 0 };

  const entryIds = [
    ...new Set(
      job.lineItems
        .map((line) => line.sourceCatalogEntryId)
        .filter((id): id is string => id !== null),
    ),
  ];

  // NO CATALOG LINES, NO QUERIES. A job of hand-typed lines is the common case,
  // and it should cost one query rather than three plus a fringe-schedule load.
  if (entryIds.length === 0) {
    return priceAnomalies(job.lineItems.map((line) => ({ line: anomalyLine(line), history: null })));
  }

  const [entries, fringeSchedulesByCraft, employerBurdenRates] = await Promise.all([
    prisma.lineItemCatalogEntry.findMany({
      // SCOPED BY COMPANY as well as by id: an id arriving from a line is not
      // on its own proof the entry belongs to this company, and a cost history
      // is exactly the thing not to read across a tenant boundary.
      where: { id: { in: entryIds }, companyId },
      select: {
        id: true,
        unit: true,
        defaultBudgetedUnitCost: true,
        // EVERY line made from this entry, on every job — the history. The
        // same select the catalog page uses, including `category` on the cost
        // entries, which is the only thing that can tell a LABOR cost sitting
        // beside logged hours from a material one.
        jobLineItems: {
          where: { isDeleted: false },
          select: {
            quantity: true,
            costEntries: { select: { amount: true, category: true } },
            timeEntries: { select: TIME_ENTRY_COST_SELECT },
            job: { select: { status: true } },
          },
        },
      },
    }),
    loadFringeSchedulesByCraft(companyId),
    loadEmployerBurdenRates(companyId),
  ]);

  const historyByEntry = new Map<string, AnomalyHistory>();
  for (const entry of entries) {
    const actuals = catalogActuals(
      entry.jobLineItems.map((line) => catalogSourcedLine(line, fringeSchedulesByCraft, employerBurdenRates)),
      entry.defaultBudgetedUnitCost === null ? null : entry.defaultBudgetedUnitCost.toNumber(),
    );
    historyByEntry.set(entry.id, {
      unit: entry.unit,
      actualUnitCost: actuals.actualUnitCost,
      // `linesWithCosts` is the sample AFTER the three exclusions, which is the
      // honest number to put in a sentence: it is the count of lines every
      // figure above was actually computed from.
      sampleSize: actuals.linesWithCosts,
    });
  }

  return priceAnomalies(
    job.lineItems.map((line) => ({
      line: anomalyLine(line),
      history: line.sourceCatalogEntryId === null ? null : historyByEntry.get(line.sourceCatalogEntryId) ?? null,
    })),
  );
}

type LineRow = {
  id: string;
  description: string;
  unit: string | null;
  unitPrice: { toNumber: () => number } | null;
  budgetedUnitCost: { toNumber: () => number } | null;
};

function anomalyLine(line: LineRow): AnomalyLine {
  return {
    id: line.id,
    description: line.description,
    unit: line.unit,
    unitPrice: line.unitPrice === null ? null : line.unitPrice.toNumber(),
    budgetedUnitCost: line.budgetedUnitCost === null ? null : line.budgetedUnitCost.toNumber(),
  };
}
