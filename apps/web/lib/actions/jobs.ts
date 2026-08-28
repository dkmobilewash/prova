"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyContext } from "@/lib/auth";
import { Prisma, prisma } from "@prova/db";
import { draftEstimateLineItems } from "@prova/integrations";
import { COST_CATEGORIES, assertEditableDirectly, assertJobInCompany, assertLineItemOnJob, craftClassificationIdFromForm, decimalFromForm, nullableDecimalFromForm, tradeScopeFromForm } from "./shared";

/** Creates a Job with a new Contact. This is the start of the estimate. */
export async function createJob(formData: FormData) {
  const { company } = await requireCompanyContext();

  const jobName = String(formData.get("jobName") ?? "").trim();
  const scope = String(formData.get("scope") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim();

  if (!jobName || !contactName) {
    throw new Error("Job name and client name are required");
  }

  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      name: contactName,
      email: contactEmail || null,
    },
  });

  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      name: jobName,
      scope: scope || null,
    },
  });

  revalidatePath("/dashboard");
  redirect(`/jobs/${job.id}`);
}

/**
 * Adds a line item directly to the estimate. Because contract/budget/costing
 * all read from JobLineItem, this single insert is what "building the
 * estimate" means — nothing else needs to be told about it separately.
 */
export async function addLineItem(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const description = String(formData.get("description") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const quantity = decimalFromForm(formData, "quantity");
  // Nullable: a cost-only budget line (general conditions, overhead,
  // contingency) has no client-facing sale price.
  const unitPrice = nullableDecimalFromForm(formData, "unitPrice");
  const budgetedUnitCost = nullableDecimalFromForm(formData, "budgetedUnitCost");
  // currentEstimatedUnitCost defaults to budgetedUnitCost at creation (app-
  // level, not a DB default) unless the form explicitly sets a different
  // value — see the field's doc comment in schema.prisma.
  const currentEstimatedUnitCost =
    nullableDecimalFromForm(formData, "currentEstimatedUnitCost") ?? budgetedUnitCost;
  const tradeScope = tradeScopeFromForm(formData);
  const laborHours = nullableDecimalFromForm(formData, "laborHours");
  const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

  if (!description) {
    throw new Error("Description is required");
  }

  await prisma.jobLineItem.create({
    data: {
      jobId,
      description,
      unit: unit || null,
      quantity,
      unitPrice,
      budgetedUnitCost,
      currentEstimatedUnitCost,
      tradeScope,
      laborHours,
      craftClassificationId,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/** Turns pasted scope-of-work text into draft JobLineItem rows — the
 * "draft-estimate-from-text" feature. Same gating as addLineItem (only an
 * ESTIMATE-stage job can get new lines this way): these are ordinary,
 * fully-editable line items the moment they're created, just flagged
 * aiDrafted for the UI to prompt review. Never auto-creates a contract or
 * changes job.status itself. */
export async function draftLineItemsFromScope(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const scopeText = String(formData.get("scopeText") ?? "").trim();
  if (!scopeText) {
    throw new Error("Paste or type a scope of work to draft from");
  }

  const draftLineItems = await draftEstimateLineItems(scopeText);

  await prisma.jobLineItem.createMany({
    data: draftLineItems.map((item) => ({
      jobId,
      description: item.description,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitPrice: item.unitPrice != null ? item.unitPrice.toString() : null,
      tradeScope: item.tradeScope,
      aiDrafted: true,
    })),
  });

  revalidatePath(`/jobs/${jobId}`);
}



/** Direct edit of a line item — only while the job is still an ESTIMATE. */
export async function updateLineItem(jobId: string, lineItemId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);
  await assertLineItemOnJob(lineItemId, jobId);

  const description = String(formData.get("description") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const quantity = decimalFromForm(formData, "quantity");
  const unitPrice = nullableDecimalFromForm(formData, "unitPrice");
  const budgetedUnitCost = nullableDecimalFromForm(formData, "budgetedUnitCost");
  const currentEstimatedUnitCost =
    nullableDecimalFromForm(formData, "currentEstimatedUnitCost") ?? budgetedUnitCost;
  const tradeScope = tradeScopeFromForm(formData);
  const laborHours = nullableDecimalFromForm(formData, "laborHours");
  const craftClassificationId = await craftClassificationIdFromForm(formData, company.id);

  if (!description) {
    throw new Error("Description is required");
  }

  await prisma.jobLineItem.update({
    where: { id: lineItemId },
    data: {
      description,
      unit: unit || null,
      quantity,
      unitPrice,
      budgetedUnitCost,
      currentEstimatedUnitCost,
      tradeScope,
      laborHours,
      craftClassificationId,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Re-forecasts a line item's cost — the PM's live percent-complete input,
 * separate from budgetedUnitCost (the frozen historical baseline) and from
 * unitPrice/quantity (client-facing terms, change-order-gated once
 * CONTRACTED). Not gated by job status, same reasoning as addCostEntry:
 * this is internal cost tracking, not a change to what the client agreed
 * to, and real spending/re-forecasting happens throughout the job.
 */
export async function updateLineItemForecast(jobId: string, lineItemId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);
  await assertLineItemOnJob(lineItemId, jobId);

  const currentEstimatedUnitCost = nullableDecimalFromForm(formData, "currentEstimatedUnitCost");
  const estimatedCostToComplete = nullableDecimalFromForm(formData, "estimatedCostToComplete");

  await prisma.jobLineItem.update({
    where: { id: lineItemId },
    data: { currentEstimatedUnitCost, estimatedCostToComplete },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/** Direct removal of a line item — only while the job is still an ESTIMATE. */
export async function deleteLineItem(jobId: string, lineItemId: string) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);
  await assertLineItemOnJob(lineItemId, jobId);

  await prisma.jobLineItem.update({
    where: { id: lineItemId },
    data: { isDeleted: true },
  });

  revalidatePath(`/jobs/${jobId}`);
}


/**
 * Locks in the estimate as a contract. From this point on, line items are
 * only editable via change orders (see assertEditableDirectly /
 * assertEditableViaChangeOrder in ./shared, applied by ./changeOrders).
 */
export async function markJobContracted(jobId: string) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);

  if (job.status !== "ESTIMATE") {
    throw new Error("Job is already contracted");
  }

  const lineItemCount = await prisma.jobLineItem.count({
    where: { jobId, isDeleted: false },
  });
  if (lineItemCount === 0) {
    throw new Error("Add at least one line item before contracting this job");
  }

  const signedRequest = await prisma.signatureRequest.findFirst({
    where: { jobId, status: "SIGNED" },
  });
  if (!signedRequest) {
    throw new Error("The client needs to sign the contract before this job can be contracted");
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "CONTRACTED" },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
}

/**
 * Logs an actual expense against a line item. Not gated by job status —
 * real spending happens throughout the job, including after it's
 * contracted and in progress, unlike scope/pricing changes.
 */
export async function addCostEntry(jobId: string, lineItemId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);
  await assertLineItemOnJob(lineItemId, jobId);

  const description = String(formData.get("description") ?? "").trim();
  const amount = decimalFromForm(formData, "amount");
  const categoryRaw = String(formData.get("category") ?? "OTHER");
  const category = COST_CATEGORIES.includes(categoryRaw as (typeof COST_CATEGORIES)[number])
    ? (categoryRaw as (typeof COST_CATEGORIES)[number])
    : "OTHER";
  const tradeScope = tradeScopeFromForm(formData);

  if (!description) {
    throw new Error("Description is required");
  }

  await prisma.costEntry.create({
    data: { lineItemId, description, amount, category, tradeScope },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/** Removes a mistaken cost entry. */
export async function deleteCostEntry(jobId: string, costEntryId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const costEntry = await prisma.costEntry.findUnique({
    where: { id: costEntryId },
    include: { lineItem: true },
  });
  if (!costEntry || costEntry.lineItem.jobId !== jobId) {
    throw new Error("Cost entry not found on this job");
  }

  await prisma.costEntry.delete({ where: { id: costEntryId } });

  revalidatePath(`/jobs/${jobId}`);
}

/** Sets a job's scheduled start/end dates. Either or both may be cleared. */
export async function updateJobSchedule(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const startRaw = String(formData.get("startDate") ?? "").trim();
  const endRaw = String(formData.get("endDate") ?? "").trim();
  const startDate = startRaw ? new Date(startRaw) : null;
  const endDate = endRaw ? new Date(endRaw) : null;

  if (startDate && endDate && endDate < startDate) {
    throw new Error("End date can't be before the start date");
  }

  const operatingLocationId = String(formData.get("operatingLocationId") ?? "").trim() || null;
  if (operatingLocationId) {
    const location = await prisma.companyLocation.findUnique({ where: { id: operatingLocationId } });
    if (!location || location.companyId !== company.id) {
      throw new Error("Location not found");
    }
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { startDate, endDate, operatingLocationId },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/schedule");
}

/** Assigns a company teammate to a job's crew. */
export async function assignCrewMember(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const userId = String(formData.get("userId") ?? "");
  const member = await prisma.user.findUnique({ where: { id: userId } });
  if (!member || member.companyId !== company.id) {
    throw new Error("Team member not found");
  }

  try {
    await prisma.jobAssignment.create({ data: { jobId, userId } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      throw error;
    }
    // Already assigned — treat as a no-op rather than an error.
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/schedule");
}

/** Removes a teammate from a job's crew. */
export async function unassignCrewMember(jobId: string, userId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  await prisma.jobAssignment.deleteMany({ where: { jobId, userId } });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/schedule");
}
