"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { unitPriceFromCost } from "@/lib/bid-recap";
import { pricingRatesFor } from "@/lib/estimating/pricing-rates";
import { NOT_ESTIMATE_STAGE } from "@/lib/estimating/draft-lines";
import { MATERIAL_KINDS, standardsFrom } from "@/lib/estimating/assemblyStandards";
import { materialGroup, materialKey, materialLabel, partOf, sameUnit } from "@/lib/estimating/materialKey";
import { actionFail, actionOk, InputError, nullableDecimalFromForm, runAction, type ActionResult } from "./shared";

const NO_ESTIMATING = "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";
const JOB_COSTS_ONLY = "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** The company's quantity standards (`assemblyStandards.ts`). Blank fields go back to the default. */
export async function saveAssemblyStandards(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  const companyId = context.company.id;
  return runAction(async () => {
    const field = (key: string, label: string, max: number) => {
      const v = nullableDecimalFromForm(formData, key, { label, min: 0, max });
      return v === null ? undefined : Number(v);
    };
    const spacing = field("studSpacingIn", "Stud spacing", 48);
    if (spacing !== undefined && ![12, 16, 19.2, 24].includes(spacing)) throw new InputError("Studs are framed at 12, 16, 19.2 or 24 inches.", "studSpacingIn");
    const raw = {
      wastePercent: Object.fromEntries(MATERIAL_KINDS.map((k) => [k, field(`waste-${k}`, `Waste on ${k}`, 50)])),
      studSpacingIn: spacing,
      screwsPerSqFt: field("screwsPerSqFt", "Screws per sq ft", 5),
      tapeLfPerSqFt: field("tapeLfPerSqFt", "Tape per sq ft", 3),
      compoundLbPerSqFt: field("compoundLbPerSqFt", "Compound per sq ft", 2),
      level5SkimLbPerSqFt: field("level5SkimLbPerSqFt", "Level 5 skim per sq ft", 2),
    };
    // Stored as entered (blanks dropped), so "not said" stays distinct from "chose the default".
    const stored = JSON.parse(JSON.stringify(raw)) as Prisma.InputJsonValue;
    standardsFrom(stored); // the same reader every consumer uses; out of range was refused above
    await prisma.companyBidDefaults.upsert({ where: { companyId }, create: { companyId, assemblyStandards: stored }, update: { assemblyStandards: stored } });
    revalidatePath("/wall-types");
    return actionOk;
  });
}

/**
 * ── ONE COST FOR ONE MATERIAL, AND EVERY LINE THAT USES IT IS PRICED ──
 *
 * The cost becomes the company's own catalog entry (so the next job prices itself), each of the
 * lines named takes a price worked from it through the company's markup — the same arithmetic as
 * `priceLineFromCost` — and the wall-type parts behind those lines point at the entry, so a later
 * sync prices their new lines too. The lines must all be unpriced and all the same material: the ids
 * are claims, and the material is read again here rather than trusted.
 */
export async function priceMaterial(jobId: string, lineIds: string[], formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const companyId = context.company.id;
  return runAction(async () => {
    const job = await prisma.job.findFirst({ where: { id: jobId, companyId }, select: { status: true } });
    if (!job) throw new InputError("That job isn't on your account any more.");
    if (job.status !== "ESTIMATE") throw new InputError(NOT_ESTIMATE_STAGE);
    const cost = nullableDecimalFromForm(formData, "unitCost", { label: "Cost", min: 0 });
    if (cost === null) throw new InputError("Type what one unit of this material costs you.", "unitCost");
    const rates = await pricingRatesFor(companyId, jobId);
    if (rates === null) throw new InputError("Set your markup first: material, labor, overhead and profit.");

    const lines = await prisma.jobLineItem.findMany({
      where: { id: { in: lineIds.slice(0, 500) }, jobId, isDeleted: false, unitPrice: null },
      select: { id: true, description: true, unit: true, quantity: true, wallTypeComponentId: true },
    });
    if (lines.length === 0) throw new InputError("Those lines are priced or gone already — refresh the page.");
    const group = materialGroup(lines[0]);
    if (lines.some((l) => materialGroup(l) !== group)) throw new InputError("Those lines are not all the same material.");

    const label = materialLabel(partOf(lines[0].description)).slice(0, 200);
    const exists = await prisma.lineItemCatalogEntry.findFirst({ where: { companyId, description: { equals: label, mode: "insensitive" } }, select: { id: true } });
    if (exists) throw new InputError(`"${label}" is already in your price book. Set its cost there, and the lines take it on the next sync.`);
    const unitPrice = (quantity: number) => unitPriceFromCost({ quantity, unitCost: Number(cost), costCategory: "MATERIAL" }, rates);

    await prisma.$transaction(async (tx) => {
      const entry = await tx.lineItemCatalogEntry.create({
        data: { companyId, description: label, unit: lines[0].unit, costCategory: "MATERIAL", defaultBudgetedUnitCost: cost, defaultUnitPrice: unitPrice(1) },
        select: { id: true },
      });
      for (const line of lines) {
        await tx.jobLineItem.update({
          where: { id: line.id },
          data: {
            budgetedUnitCost: cost,
            currentEstimatedUnitCost: cost,
            unitPrice: unitPrice(Number(line.quantity)),
            costCategory: "MATERIAL",
            // The new entry has no production rate, so the line keeps the one its wall-type part gave it.
            productionRate: undefined,
            sourceCatalogEntryId: entry.id,
            priceBasis: "COMPANY_CATALOG",
          },
        });
      }
      // The parts behind these lines, and any other part of the company's that is the same material in the same unit.
      const direct = lines.map((l) => l.wallTypeComponentId).filter((id): id is string => id !== null);
      const key = materialKey(partOf(lines[0].description));
      const unit = sameUnit(lines[0].unit);
      const others = key === null || key.includes("?")
        ? []
        : (await tx.wallTypeComponent.findMany({ where: { wallType: { companyId }, catalogEntryId: null }, select: { id: true, description: true, unit: true } }))
            .filter((c) => materialKey(c.description) === key && sameUnit(c.unit) === unit)
            .map((c) => c.id);
      await tx.wallTypeComponent.updateMany({ where: { id: { in: [...direct, ...others] }, wallType: { companyId }, catalogEntryId: null }, data: { catalogEntryId: entry.id } });
    });
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/estimate`);
    return actionOk;
  });
}
