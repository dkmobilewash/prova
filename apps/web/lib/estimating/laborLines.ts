import type { Prisma } from "@prova/db";
import { ownMarkupSet, RECAP_RATE_KEYS, unitPriceFromCost, type RecapRates } from "@/lib/bid-recap";
import { openingsFromJson, runGeometry } from "@/lib/wall-assemblies";
import { openingThresholdSqFt as thresholdFor } from "@/lib/businessScope";
import { laborAssembly, laborPlan, ratesFromJson, type LaborPlan, type WallForLabor } from "./productionRates";
import { wallItemsForLabor } from "./takeoff-item-lines";

type Tx = Prisma.TransactionClient;

/** Every labor line this writes starts with this, which is how it finds its own lines again. */
export const LABOR_PREFIX = "Labor — ";

/**
 * ── THE ESTIMATE'S LABOR, WORKED OUT FROM WHAT IS CONFIRMED ──
 *
 * The job's priced walls (traced items and wall-schedule runs) and its ceiling lines, through the
 * company's production rates (`productionRates.ts`), into one HR line per task per wall type and
 * height band: "Labor — S6A — hang type X board, 2 layers, over 10 ft". The same three rules as the
 * material expanders:
 *
 *  1. Update in place: a line is found by its words and only its HOURS move; a price somebody typed
 *     stays theirs.
 *  2. A new line is costed at the crew rate and priced through the job's labor markup.
 *  3. A line no longer wanted is soft-deleted; one a person deleted is never rebuilt.
 *
 * Nothing is written for a task whose rate is blank — `missing` says which, and the estimate asks.
 */
export async function syncLaborLines(tx: Tx, companyId: string, jobId: string): Promise<LaborPlan> {
  const { rates, plan } = await laborPlanFor(tx, companyId, jobId);

  const existing = await tx.jobLineItem.findMany({
    where: { jobId, costCategory: "LABOR", description: { startsWith: LABOR_PREFIX }, takeoffItemId: null, wallTypeComponentId: null },
    select: { id: true, description: true, isDeleted: true },
  });
  const live = new Map(existing.filter((l) => !l.isDeleted).map((l) => [l.description, l.id]));
  const deletedByHand = new Set(existing.filter((l) => l.isDeleted).map((l) => l.description));
  const jobRates = rates.crewRatePerHr === null ? null : await jobRatesFor(tx, companyId, jobId);
  const wanted = new Set<string>();
  for (const line of rates.crewRatePerHr === null ? [] : plan.lines) {
    wanted.add(line.description);
    const id = live.get(line.description);
    if (id) {
      await tx.jobLineItem.update({ where: { id }, data: { quantity: line.hours.toFixed(2), laborHours: line.hours.toFixed(2) } });
      continue;
    }
    if (deletedByHand.has(line.description)) continue;
    const cost = rates.crewRatePerHr!;
    await tx.jobLineItem.create({
      data: {
        jobId,
        description: line.description,
        unit: "HR",
        quantity: line.hours.toFixed(2),
        laborHours: line.hours.toFixed(2),
        costCategory: "LABOR",
        budgetedUnitCost: cost.toFixed(2),
        currentEstimatedUnitCost: cost.toFixed(2),
        unitPrice: jobRates === null ? null : unitPriceFromCost({ quantity: line.hours, unitCost: cost, costCategory: "LABOR" }, jobRates),
      },
    });
  }
  for (const line of existing) {
    if (line.isDeleted || wanted.has(line.description)) continue;
    // Soft-deleted and RENAMED out of this function's reach — the words are the key, so a soft-deleted line
    // still carrying them means a person deleted it. This one was removed by the rates or the walls changing.
    await tx.jobLineItem.update({ where: { id: line.id }, data: { isDeleted: true, description: `(no longer needed) ${line.description}`.slice(0, 500) } });
  }
  return plan;
}

/**
 * The job's pricing rates — its own recap, else the company's — read through the TRANSACTION. Not
 * `pricingRatesFor`: that imports the Prisma client, and this module rides into the browser bundle
 * behind `takeoff-item-lines.ts` (`client-prisma-boundary.test.ts` caught it).
 */
async function jobRatesFor(tx: Tx, companyId: string, jobId: string): Promise<RecapRates | null> {
  const source = (await tx.jobBidRecap.findFirst({ where: { jobId, companyId } })) ?? (await tx.companyBidDefaults.findUnique({ where: { companyId } }));
  if (source === null) return null;
  const record = source as unknown as Record<string, unknown>;
  const rates = Object.fromEntries(RECAP_RATE_KEYS.map((key) => [key, record[key] != null ? Number(record[key]) : null])) as RecapRates;
  return ownMarkupSet(rates) ? rates : null;
}

/** The labor the job's walls and ceilings come to at the company's rates, written nowhere — what the estimate's prompt reads. */
export async function laborPlanFor(tx: Tx, companyId: string, jobId: string): Promise<{ rates: ReturnType<typeof ratesFromJson>; plan: LaborPlan }> {
  const defaults = await tx.companyBidDefaults.findUnique({ where: { companyId }, select: { productionRates: true } });
  const rates = ratesFromJson(defaults?.productionRates);
  return { rates, plan: laborPlan(await wallsForLabor(tx, companyId, jobId, rates.defaultFinishLevel), await ceilingsForLabor(tx, jobId), rates) };
}

/** The job's priced walls, each at its own height, with what labor needs to know about its wall type. */
async function wallsForLabor(tx: Tx, companyId: string, jobId: string, defaultFinishLevel: 3 | 4 | 5): Promise<WallForLabor[]> {
  const items = await wallItemsForLabor(tx, companyId, jobId);
  const runs = await tx.wallRun.findMany({ where: { jobId, companyId } });
  const typeIds = [...new Set([...items.map((i) => i.wallTypeId), ...runs.map((r) => r.wallTypeId)])];
  if (typeIds.length === 0) return [];
  const types = await tx.wallType.findMany({ where: { id: { in: typeIds }, companyId }, include: { components: true } });
  const typeById = new Map(types.map((t) => [t.id, t]));
  const assemblyOf = (id: string) => {
    const t = typeById.get(id)!;
    return laborAssembly(t.components.map((c) => ({ description: c.description, unit: c.unit, basis: c.basis, factor: Number(c.factor) })), defaultFinishLevel);
  };
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { openingDeduction: true, openingDeductionSqFt: true } });
  const openingThresholdSqFt = company.openingDeduction === null ? undefined : thresholdFor(company.openingDeduction, company.openingDeductionSqFt === null ? null : Number(company.openingDeductionSqFt));
  const out: WallForLabor[] = items.filter((i) => typeById.has(i.wallTypeId)).map((i) => ({ code: typeById.get(i.wallTypeId)!.code, assembly: assemblyOf(i.wallTypeId), heightFt: i.heightFt, linearFt: i.linearFt, boardedSqFt: i.boardedSqFt }));
  for (const run of runs) {
    const t = typeById.get(run.wallTypeId);
    if (!t) continue;
    const geometry = runGeometry(
      { id: run.id, label: run.label, wallTypeId: run.wallTypeId, lengthFt: Number(run.lengthFt), heightFt: run.heightFt === null ? null : Number(run.heightFt), openings: openingsFromJson(run.openings) },
      { id: t.id, code: t.code, defaultHeightFt: t.defaultHeightFt === null ? null : Number(t.defaultHeightFt), sides: t.sides, studSpacingIn: Number(t.studSpacingIn), components: [] },
      { openingThresholdSqFt },
    );
    if (geometry) out.push({ code: t.code, assembly: assemblyOf(t.id), heightFt: geometry.heightFt, linearFt: geometry.linearFt, boardedSqFt: geometry.boardedSqFt });
  }
  return out;
}

/** The job's ceiling lines (the takeoff's "Ceiling — …" items), by their square feet. */
async function ceilingsForLabor(tx: Tx, jobId: string): Promise<{ description: string; squareFeet: number }[]> {
  const lines = await tx.jobLineItem.findMany({
    where: { jobId, isDeleted: false, wallTypeComponentId: null, takeoffItemId: { not: null }, description: { startsWith: "Ceiling — " } },
    select: { description: true, quantity: true, unit: true },
  });
  return lines.filter((l) => /^(sq ft|sf)$/i.test(l.unit ?? "")).map((l) => ({ description: l.description, squareFeet: Number(l.quantity) }));
}
