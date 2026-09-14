import { prisma } from "@prova/db";
import type { ActionResultWith } from "@/lib/actions/shared";
import { NOT_ESTIMATE_STAGE } from "./draft-lines";

/**
 * "Add 200 SF of 5/8 Type X to the estimate" — the body of
 * `addLineItemFromCatalog`, lifted so the Ask command can call it by id.
 * Same rows written and the same `sourceCatalogEntryId` reference; guards
 * return their sentence instead of throwing it. `priceBasis` follows the
 * price rather than the source — see the write below.
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
      // A basis is a claim about a PRICE. An entry with no default price
      // lends none — the card says so in its own words ("No default price
      // on the catalog entry") — so the row makes no claim either, rather
      // than stamping "your catalog price" on a blank. Same rule
      // `priceBasisFor` applies to a drafted line, at the other write.
      priceBasis: entry.defaultUnitPrice != null ? "COMPANY_CATALOG" : null,
    },
    select: { id: true },
  });

  return { ok: true, value: { lineItemId: line.id, description: entry.description, unit: entry.unit } };
}
