import type { Prisma } from "@prova/db";
import { ownMarkupSet, RECAP_RATE_KEYS, unitPriceFromCost, type RecapRates } from "@/lib/bid-recap";
import { catalogByMaterial, catalogFor, materialGroup, materialKey } from "./materialKey";
import { convert, type Need } from "./priceList";

type Tx = Prisma.TransactionClient;

/**
 * ── THE COMPANY'S CATALOG, APPLIED TO WHAT IS WAITING FOR A PRICE ──
 *
 * After a price list lands in the catalog: every wall-type part with no catalog entry is linked to
 * the entry for the same material in the same unit (`catalogFor` — two candidates link neither), and
 * every UNPRICED generated line on the company's estimate-stage jobs whose part now has a costed
 * entry is priced through that job's own markup — the arithmetic `priceLineFromCost` uses. A line
 * that already has a price is never touched: re-pricing a bid somebody may have sent is a decision,
 * not a side effect of an import. A job whose markup is not set is left alone and counted.
 */
export async function applyCatalogPrices(tx: Tx, companyId: string, direct: { componentIds: string[]; entryId: string }[] = [], onlyJobId?: string): Promise<{ linked: number; priced: number; jobs: number; noMarkup: number }> {
  const entries = await tx.lineItemCatalogEntry.findMany({ where: { companyId }, select: { id: true, description: true, unit: true } });
  const catalog = catalogByMaterial(entries);
  const loose = await tx.wallTypeComponent.findMany({ where: { wallType: { companyId }, catalogEntryId: null }, select: { id: true, description: true, unit: true } });
  let linked = 0;
  for (const c of loose) {
    const entryId = catalogFor(catalog, c);
    if (entryId === null) continue;
    await tx.wallTypeComponent.update({ where: { id: c.id }, data: { catalogEntryId: entryId } });
    linked += 1;
  }
  for (const d of direct) {
    linked += (await tx.wallTypeComponent.updateMany({ where: { id: { in: d.componentIds }, wallType: { companyId }, catalogEntryId: null }, data: { catalogEntryId: d.entryId } })).count;
  }

  const lines = await tx.jobLineItem.findMany({
    where: {
      isDeleted: false,
      unitPrice: null,
      job: { companyId, status: "ESTIMATE", ...(onlyJobId ? { id: onlyJobId } : {}) },
      wallTypeComponent: { catalogEntry: { OR: [{ defaultBudgetedUnitCost: { not: null } }, { defaultUnitPrice: { not: null } }] } },
    },
    select: { id: true, jobId: true, quantity: true, costCategory: true, wallTypeComponent: { select: { catalogEntry: { select: { id: true, defaultBudgetedUnitCost: true, defaultUnitPrice: true, costCategory: true } } } } },
  });
  const ratesByJob = new Map<string, RecapRates | null>();
  const defaults = await tx.companyBidDefaults.findUnique({ where: { companyId } });
  let priced = 0;
  const jobs = new Set<string>();
  const noMarkup = new Set<string>();
  for (const line of lines) {
    const entry = line.wallTypeComponent!.catalogEntry!;
    // The entry's own category (a labor price takes the labor markup), else the part's, else material.
    const costCategory = entry.costCategory ?? line.costCategory ?? "MATERIAL";
    // A price-book entry holding a selling price and no cost: that price is the company's answer.
    if (entry.defaultBudgetedUnitCost === null) {
      await tx.jobLineItem.update({ where: { id: line.id }, data: { unitPrice: entry.defaultUnitPrice, costCategory, productionRate: undefined, sourceCatalogEntryId: entry.id, priceBasis: "COMPANY_CATALOG" } });
      priced += 1;
      jobs.add(line.jobId);
      continue;
    }
    if (!ratesByJob.has(line.jobId)) {
      const recap = await tx.jobBidRecap.findFirst({ where: { jobId: line.jobId, companyId } });
      ratesByJob.set(line.jobId, ratesFrom(recap ?? defaults));
    }
    const rates = ratesByJob.get(line.jobId)!;
    if (rates === null) {
      noMarkup.add(line.jobId);
      continue;
    }
    const cost = Number(entry.defaultBudgetedUnitCost);
    const unitPrice = unitPriceFromCost({ quantity: Number(line.quantity), unitCost: cost, costCategory }, rates);
    if (unitPrice === null) continue;
    await tx.jobLineItem.update({
      where: { id: line.id },
      data: {
        budgetedUnitCost: entry.defaultBudgetedUnitCost,
        currentEstimatedUnitCost: entry.defaultBudgetedUnitCost,
        unitPrice,
        costCategory,
        // The entry came from a price list and carries no production rate; the line keeps its part's.
        productionRate: undefined,
        sourceCatalogEntryId: entry.id,
        priceBasis: "COMPANY_CATALOG",
      },
    });
    priced += 1;
    jobs.add(line.jobId);
  }
  return { linked, priced, jobs: jobs.size, noMarkup: noMarkup.size };
}

/** The rates a job's lines are priced from (its recap, else the company's), or null until the four own rates are set. */
export function ratesFrom(source: Record<string, unknown> | null): RecapRates | null {
  if (source === null) return null;
  const rates = Object.fromEntries(RECAP_RATE_KEYS.map((key) => [key, source[key] != null ? Number(source[key]) : null])) as RecapRates;
  return ownMarkupSet(rates) ? rates : null;
}

/** What the estimate is waiting to price: each material a wall-type part names with no catalog entry, once. */
export async function priceNeeds(tx: Tx, companyId: string): Promise<(Need & { componentIds: string[] })[]> {
  const loose = await tx.wallTypeComponent.findMany({ where: { wallType: { companyId }, catalogEntryId: null }, select: { id: true, description: true, unit: true }, orderBy: { sortOrder: "asc" } });
  const needs = new Map<string, Need & { componentIds: string[] }>();
  for (const c of loose) {
    const group = materialGroup(c);
    const was = needs.get(group);
    if (was) was.componentIds.push(c.id);
    else needs.set(group, { group, label: c.description.replace(/\s*\((?:[^)]*)\)\s*/g, " ").replace(/\s+at\s+\d+(?:\.\d+)?in o\.c\.?/i, "").trim(), unit: c.unit, componentIds: [c.id] });
  }
  return [...needs.values()];
}

export type PriceSource = { vendor: string; quotedOn: Date; stale: boolean };

/**
 * Where a catalog price came from: the latest supplier quote linked to the entry, shown ONLY while the
 * entry's cost still equals what that quote converts to — once somebody types a different cost, the
 * quote is no longer the source and saying so would be a lie. Derived every time, never stored.
 */
export function priceSource(
  entry: { description: string; defaultBudgetedUnitCost: { toString(): string } | null },
  quotes: readonly { description: string; unit: string | null; unitPrice: { toString(): string }; quotedOn: Date; vendor: { name: string } }[],
  rollLf: number,
  today: Date,
): PriceSource | null {
  if (entry.defaultBudgetedUnitCost === null) return null;
  const cost = Number(entry.defaultBudgetedUnitCost.toString());
  const key = materialKey(entry.description);
  const latest = [...quotes].sort((a, b) => b.quotedOn.getTime() - a.quotedOn.getTime())[0];
  if (!latest || key === null) return null;
  const rowKey = materialKey(latest.description) ?? key;
  const converted = convert({ description: latest.description, unit: latest.unit, price: Number(latest.unitPrice.toString()) }, rowKey.includes("?") ? key : rowKey, rollLf);
  if (converted.price === null || Math.round(converted.price * 100) / 100 !== cost) return null;
  return { vendor: latest.vendor.name, quotedOn: latest.quotedOn, stale: today.getTime() - latest.quotedOn.getTime() > 90 * 86_400_000 };
}
