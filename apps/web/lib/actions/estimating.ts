"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { parseCatalogImport, splitAgainstExisting } from "@/lib/catalog-import";
import { BID_INVITATION_STATUSES, assertEditableDirectly, assertJobInCompany, assertOwner, craftClassificationIdFromForm, decimalFromForm, enumFromForm, nullableDecimalFromForm, tradeScopeFromForm } from "./shared";

/** Logs a GC inviting this company to bid — tracked independent of Job,
 * since most invitations are declined or lost and never become one. */
export async function createBidInvitation(contactId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.companyId !== company.id) {
    throw new Error("Contact not found");
  }

  const projectName = String(formData.get("projectName") ?? "").trim();
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const tradeScope = tradeScopeFromForm(formData);
  const bidAmount = nullableDecimalFromForm(formData, "bidAmount");

  if (!projectName) {
    throw new Error("Project name is required");
  }

  await prisma.bidInvitation.create({
    data: {
      companyId: company.id,
      contactId,
      projectName,
      dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
      notes: notes || null,
      tradeScope,
      bidAmount,
    },
  });

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/bids");
}

/** Updates a bid invitation's outcome (invited/submitted/won/lost/declined)
 * and, once known, what was actually bid — together with tradeScope this
 * is what makes the table a historical bid database, not just a log. */
export async function updateBidInvitationStatus(bidInvitationId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidInvitationId } });
  if (!bid || bid.companyId !== company.id) {
    throw new Error("Bid invitation not found");
  }

  const status = enumFromForm(formData, "status", BID_INVITATION_STATUSES);
  const bidAmount = nullableDecimalFromForm(formData, "bidAmount");

  await prisma.bidInvitation.update({ where: { id: bidInvitationId }, data: { status, bidAmount } });

  revalidatePath(`/contacts/${bid.contactId}`);
  revalidatePath("/bids");
}

export async function deleteBidInvitation(bidInvitationId: string) {
  const { company } = await requireCompanyContext();

  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidInvitationId } });
  if (!bid || bid.companyId !== company.id) {
    throw new Error("Bid invitation not found");
  }

  await prisma.bidInvitation.delete({ where: { id: bidInvitationId } });

  revalidatePath(`/contacts/${bid.contactId}`);
  revalidatePath("/bids");
}

/** Adds a reusable line-item template, scoped to the company. Not tied to
 * any job — see LineItemCatalogEntry in schema.prisma. */
export async function createLineItemCatalogEntry(formData: FormData) {
  const { company } = await requireCompanyContext();

  const description = String(formData.get("description") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const tradeScope = tradeScopeFromForm(formData);
  const defaultUnitPrice = nullableDecimalFromForm(formData, "defaultUnitPrice");
  const defaultBudgetedUnitCost = nullableDecimalFromForm(formData, "defaultBudgetedUnitCost");
  const defaultLaborHours = nullableDecimalFromForm(formData, "defaultLaborHours");
  const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

  if (!description) {
    throw new Error("Description is required");
  }

  await prisma.lineItemCatalogEntry.create({
    data: {
      companyId: company.id,
      description,
      unit: unit || null,
      tradeScope,
      defaultUnitPrice,
      defaultBudgetedUnitCost,
      defaultLaborHours,
      craftClassificationId,
    },
  });

  revalidatePath("/catalog");
}

export async function deleteLineItemCatalogEntry(catalogEntryId: string) {
  const { company } = await requireCompanyContext();

  const entry = await prisma.lineItemCatalogEntry.findUnique({ where: { id: catalogEntryId } });
  if (!entry || entry.companyId !== company.id) {
    throw new Error("Catalog entry not found");
  }

  await prisma.lineItemCatalogEntry.delete({ where: { id: catalogEntryId } });

  revalidatePath("/catalog");
}

/** Turns an existing estimate line into a reusable catalog entry — the way
 * the catalog actually grows in practice, from real priced work, rather
 * than requiring separate manual data entry. */
export async function saveLineItemAsCatalogEntry(lineItemId: string) {
  const { company } = await requireCompanyContext();

  const lineItem = await prisma.jobLineItem.findUnique({
    where: { id: lineItemId },
    include: { job: true },
  });
  if (!lineItem || lineItem.job.companyId !== company.id) {
    throw new Error("Line item not found");
  }

  await prisma.lineItemCatalogEntry.create({
    data: {
      companyId: company.id,
      description: lineItem.description,
      unit: lineItem.unit,
      tradeScope: lineItem.tradeScope,
      defaultUnitPrice: lineItem.unitPrice,
      defaultBudgetedUnitCost: lineItem.budgetedUnitCost,
      defaultLaborHours: lineItem.laborHours,
      craftClassificationId: lineItem.craftClassificationId,
    },
  });

  revalidatePath("/catalog");
}

/** Adds a new JobLineItem pre-filled from a catalog entry, through the
 * exact same create call addLineItem uses — a catalog entry is a template
 * for that call, not a second live copy of estimate data. */
export async function addLineItemFromCatalog(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const catalogEntryId = String(formData.get("catalogEntryId") ?? "").trim();
  const entry = await prisma.lineItemCatalogEntry.findUnique({ where: { id: catalogEntryId } });
  if (!entry || entry.companyId !== company.id) {
    throw new Error("Catalog entry not found");
  }

  const quantity = decimalFromForm(formData, "quantity");

  await prisma.jobLineItem.create({
    data: {
      jobId,
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
  });

  revalidatePath(`/jobs/${jobId}`);
}

/** Saves a manual checkpoint of the estimate's current line items — "what
 * did we price this at before the scope changed." A snapshot, not an
 * automatic log of every edit; only available pre-award, same gate as
 * every other direct estimate edit. */
export async function saveEstimateVersion(jobId: string, formData: FormData) {
  const { company, ...user } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const note = String(formData.get("note") ?? "").trim();

  const [lineItems, lastVersion] = await Promise.all([
    prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, orderBy: { sortOrder: "asc" } }),
    prisma.estimateVersion.findFirst({ where: { jobId }, orderBy: { versionNumber: "desc" } }),
  ]);

  await prisma.estimateVersion.create({
    data: {
      jobId,
      versionNumber: (lastVersion?.versionNumber ?? 0) + 1,
      note: note || null,
      snapshot: lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unit: item.unit,
        tradeScope: item.tradeScope,
        unitPrice: item.unitPrice?.toString() ?? null,
        budgetedUnitCost: item.budgetedUnitCost?.toString() ?? null,
        laborHours: item.laborHours?.toString() ?? null,
      })),
      createdByUserId: user.id,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Sets a catalog entry's default cost from what work priced off it has
 * actually cost. Explicit, one click, never automatic.
 *
 * The invariant this has to respect is the one that makes the catalog safe:
 * an entry is a TEMPLATE, not a live link. This updates the template and
 * nothing else. Every JobLineItem already created from it keeps the numbers
 * it was created with — as do every EstimateVersion snapshot and every
 * Invoice drawn from them. A contractor who re-prices their catalog in
 * March must not find that a job they bid in January silently changed.
 *
 * Sale price is a separate, opt-in decision. Cost is a fact the jobs
 * measured; price is a margin call that belongs to the estimator, so
 * "our cost went up 20%" does not silently become "we now charge 20% more".
 */
export async function updateCatalogDefaultsFromActuals(entryId: string, formData: FormData) {
  const { company, ...user } = await requireCompanyContext();
  assertOwner(user, "Only the account owner can re-price the catalog");

  const entry = await prisma.lineItemCatalogEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.companyId !== company.id) {
    throw new Error("Catalog entry not found");
  }

  const actualUnitCost = nullableDecimalFromForm(formData, "actualUnitCost");
  if (actualUnitCost === null) {
    throw new Error("No actual cost to update from");
  }

  // Only ever the entry's own defaults — no JobLineItem is in scope here.
  const data: { defaultBudgetedUnitCost: string; defaultUnitPrice?: string } = {
    defaultBudgetedUnitCost: actualUnitCost,
  };

  // Opt-in: hold the existing margin over the new cost, so the price moves
  // by the same proportion rather than collapsing to cost.
  if (String(formData.get("alsoUpdatePrice") ?? "") === "on") {
    const oldCost = entry.defaultBudgetedUnitCost != null ? Number(entry.defaultBudgetedUnitCost) : null;
    const oldPrice = entry.defaultUnitPrice != null ? Number(entry.defaultUnitPrice) : null;
    if (oldCost && oldCost > 0 && oldPrice != null) {
      data.defaultUnitPrice = ((oldPrice / oldCost) * Number(actualUnitCost)).toFixed(2);
    }
    // With no prior cost or price there is no margin to preserve, and
    // inventing one would be a pricing decision this action has no business
    // making — the cost still updates, the price is left alone.
  }

  await prisma.lineItemCatalogEntry.update({ where: { id: entryId }, data });

  revalidatePath("/catalog");
}

/**
 * Creates catalog entries from a pasted price list.
 *
 * The text is re-parsed here rather than trusting rows the browser sends.
 * The client parses the same text with the same function to render a
 * preview, but a preview is a courtesy — what gets written is decided from
 * the raw text on the server, so a tampered or stale payload can't put
 * numbers into the catalog that nobody saw.
 *
 * Existing entries are never overwritten and never silently duplicated.
 * Re-importing an updated price list is the normal case, and a catalog with
 * two "5/8in Type X board" rows at different prices is worse than one that
 * refused the second. Updating a price stays where it already lives: the
 * entry's own controls, and the actuals loop.
 */
export async function importCatalogEntries(formData: FormData) {
  const { company, ...user } = await requireCompanyContext();
  assertOwner(user, "Only the account owner can import a price list");

  const text = String(formData.get("csv") ?? "");
  if (!text.trim()) {
    throw new Error("Paste a price list, or choose a CSV file, before importing");
  }

  const { rows } = parseCatalogImport(text);
  if (rows.length === 0) {
    throw new Error("Nothing readable to import — check the preview for what went wrong");
  }

  const existing = await prisma.lineItemCatalogEntry.findMany({
    where: { companyId: company.id },
    select: { description: true },
  });
  const { fresh } = splitAgainstExisting(
    rows,
    existing.map((entry) => entry.description),
  );

  if (fresh.length === 0) {
    throw new Error("Every item in that list is already in the catalog — nothing to add");
  }

  await prisma.lineItemCatalogEntry.createMany({
    data: fresh.map((row) => ({
      companyId: company.id,
      description: row.description,
      unit: row.unit,
      defaultUnitPrice: row.unitPrice != null ? row.unitPrice.toString() : null,
      defaultBudgetedUnitCost: row.budgetedUnitCost != null ? row.budgetedUnitCost.toString() : null,
      defaultLaborHours: row.laborHours != null ? row.laborHours.toString() : null,
      tradeScope: row.tradeScope,
    })),
  });

  revalidatePath("/catalog");
}
