"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { BID_INVITATION_STATUSES, assertEditableDirectly, assertJobInCompany, craftClassificationIdFromForm, decimalFromForm, enumFromForm, nullableDecimalFromForm, tradeScopeFromForm } from "./shared";

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
