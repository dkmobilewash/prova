import { prisma } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";
import { NOT_ESTIMATE_STAGE } from "./draft-lines";

/**
 * "Add 200 SF of 5/8 Type X to the estimate" — the body of
 * `addLineItemFromCatalog`, lifted so the Ask command can call it by id.
 * Same rows written, same `priceBasis: COMPANY_CATALOG`, same
 * `sourceCatalogEntryId` reference; guards return their sentence instead of
 * throwing it.
 *
 * The quantity arrives as the person's own typed string and is stored as
 * the Decimal it parses to. No extended total is computed here or anywhere
 * near the model: the job page does that arithmetic, once.
 */
export async function addCatalogLine(
  companyId: string,
  input: { jobId: string; catalogEntryId: string; quantity: string },
): Promise<ActionResultWith<{ lineItemId: string; description: string; unit: string | null }>> {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId },
    select: { id: true, status: true },
  });
  if (!job) {
    return { ok: false, error: "Job not found" };
  }
  if (job.status !== "ESTIMATE") {
    return { ok: false, error: NOT_ESTIMATE_STAGE };
  }

  const entry = await prisma.lineItemCatalogEntry.findFirst({
    where: { id: input.catalogEntryId, companyId },
  });
  if (!entry) {
    return { ok: false, error: "Catalog entry not found" };
  }

  const quantity = input.quantity.trim();
  // The same test decimalFromForm applies, so the form's behaviour is
  // unchanged; the Ask command is stricter before it gets here.
  if (!quantity || Number.isNaN(Number(quantity))) {
    return { ok: false, error: '"quantity" must be a number' };
  }

  const line = await prisma.jobLineItem.create({
    data: {
      jobId: job.id,
      description: entry.description,
      unit: entry.unit,
      quantity,
      unitPrice: entry.defaultUnitPrice,
      budgetedUnitCost: entry.defaultBudgetedUnitCost,
      currentEstimatedUnitCost: entry.defaultBudgetedUnitCost,
      tradeScope: entry.tradeScope,
      laborHours: entry.defaultLaborHours,
      craftClassificationId: entry.craftClassificationId,
      // Records which template this came from, so /catalog can later report
      // how work priced from it actually costed. A reference, not a live
      // link: changing the entry's defaults never touches this row.
      sourceCatalogEntryId: entry.id,
      priceBasis: "COMPANY_CATALOG",
    },
    select: { id: true },
  });

  return { ok: true, value: { lineItemId: line.id, description: entry.description, unit: entry.unit } };
}
