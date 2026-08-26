"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { put } from "@vercel/blob";
import { Prisma, prisma } from "@prova/db";
import {
  revokeToken,
  refreshTokens,
  getCompanyInfo,
  generateWipNarrative,
  extractComplianceDocument,
  draftEstimateLineItems,
  type QuickBooksCompanyInfo,
} from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { calculateLineItemWip, calculateJobWip } from "@/lib/wip";

function decimalFromForm(formData: FormData, key: string): string {
  const raw = formData.get(key);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || Number.isNaN(Number(value))) {
    throw new Error(`"${key}" must be a number`);
  }
  return value;
}

/** Like decimalFromForm, but an empty field is valid and means "not set"
 * (null) rather than an error — used for unitPrice (cost-only budget
 * lines have none) and the WIP cost fields (optional until entered). */
function nullableDecimalFromForm(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return null;
  }
  if (Number.isNaN(Number(value))) {
    throw new Error(`"${key}" must be a number`);
  }
  return value;
}

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

async function assertJobInCompany(jobId: string, companyId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.companyId !== companyId) {
    throw new Error("Job not found");
  }
  return job;
}

/**
 * Only an ESTIMATE-stage job allows direct line-item edits. Once a job is
 * CONTRACTED, scope/pricing changes must go through a change order so
 * there's an audit trail of what changed after the client agreed to it.
 */
function assertEditableDirectly(job: { status: string }) {
  if (job.status !== "ESTIMATE") {
    throw new Error(
      "This job is contracted — edit line items via a change order instead of directly.",
    );
  }
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

/**
 * Change orders only make sense once there's a contracted baseline to
 * change. Before that, direct edits (see assertEditableDirectly) are the
 * right tool.
 */
function assertEditableViaChangeOrder(job: { status: string }) {
  if (job.status === "ESTIMATE") {
    throw new Error("This job isn't contracted yet — edit line items directly instead.");
  }
}

async function nextChangeOrderNumber(jobId: string) {
  const last = await prisma.changeOrder.findFirst({
    where: { jobId },
    orderBy: { number: "desc" },
  });
  return (last?.number ?? 0) + 1;
}

/**
 * Adds NEW scope via a change order: a JobLineItem row tagged with
 * originChangeOrderId. It is the same table the estimate was built from —
 * the budget total updates the moment this commits, no re-entry elsewhere.
 */
export async function addChangeOrderLineItem(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableViaChangeOrder(job);

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const itemDescription = String(formData.get("itemDescription") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const quantity = decimalFromForm(formData, "quantity");
  const unitPrice = nullableDecimalFromForm(formData, "unitPrice");
  const budgetedUnitCost = nullableDecimalFromForm(formData, "budgetedUnitCost");
  const currentEstimatedUnitCost =
    nullableDecimalFromForm(formData, "currentEstimatedUnitCost") ?? budgetedUnitCost;
  const tradeScope = tradeScopeFromForm(formData);

  if (!title || !itemDescription) {
    throw new Error("Change order title and line item description are required");
  }

  const number = await nextChangeOrderNumber(jobId);

  await prisma.changeOrder.create({
    data: {
      jobId,
      number,
      title,
      description: description || null,
      addedLineItems: {
        create: {
          jobId,
          description: itemDescription,
          unit: unit || null,
          quantity,
          unitPrice,
          budgetedUnitCost,
          currentEstimatedUnitCost,
          tradeScope,
        },
      },
    },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Modifies an EXISTING line item via a change order: the row is updated in
 * place (never forked), and the before/after values are logged to
 * ChangeOrderLineItemEdit purely for audit history.
 */
export async function editLineItemViaChangeOrder(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableViaChangeOrder(job);

  const lineItemId = String(formData.get("lineItemId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const newQuantity = decimalFromForm(formData, "quantity");
  const newUnitPrice = nullableDecimalFromForm(formData, "unitPrice");

  if (!title || !lineItemId) {
    throw new Error("Change order title and target line item are required");
  }

  const lineItem = await prisma.jobLineItem.findUnique({ where: { id: lineItemId } });
  if (!lineItem || lineItem.jobId !== jobId) {
    throw new Error("Line item not found on this job");
  }

  const number = await nextChangeOrderNumber(jobId);
  const edits: { lineItemId: string; field: string; oldValue: string; newValue: string }[] = [];
  if (lineItem.quantity.toString() !== newQuantity) {
    edits.push({
      lineItemId: lineItem.id,
      field: "quantity",
      oldValue: lineItem.quantity.toString(),
      newValue: newQuantity,
    });
  }
  if ((lineItem.unitPrice?.toString() ?? "") !== (newUnitPrice ?? "")) {
    edits.push({
      lineItemId: lineItem.id,
      field: "unitPrice",
      oldValue: lineItem.unitPrice?.toString() ?? "(none)",
      newValue: newUnitPrice ?? "(none)",
    });
  }

  await prisma.$transaction([
    prisma.changeOrder.create({
      data: {
        jobId,
        number,
        title,
        description: description || null,
        edits: {
          create: edits,
        },
      },
    }),
    prisma.jobLineItem.update({
      where: { id: lineItemId },
      data: { quantity: newQuantity, unitPrice: newUnitPrice },
    }),
  ]);

  revalidatePath(`/jobs/${jobId}`);
}

async function assertLineItemOnJob(lineItemId: string, jobId: string) {
  const lineItem = await prisma.jobLineItem.findUnique({ where: { id: lineItemId } });
  if (!lineItem || lineItem.jobId !== jobId) {
    throw new Error("Line item not found on this job");
  }
  return lineItem;
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
 * Removes an EXISTING line item via a change order once the job is
 * contracted: soft-deletes the same row (never forks it) and logs the
 * removal to ChangeOrderLineItemEdit for audit history.
 */
export async function removeLineItemViaChangeOrder(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableViaChangeOrder(job);

  const lineItemId = String(formData.get("lineItemId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!title || !lineItemId) {
    throw new Error("Change order title and target line item are required");
  }

  const lineItem = await assertLineItemOnJob(lineItemId, jobId);
  const number = await nextChangeOrderNumber(jobId);

  await prisma.$transaction([
    prisma.changeOrder.create({
      data: {
        jobId,
        number,
        title,
        description: description || null,
        edits: {
          create: [{ lineItemId: lineItem.id, field: "deleted", oldValue: "false", newValue: "true" }],
        },
      },
    }),
    prisma.jobLineItem.update({
      where: { id: lineItemId },
      data: { isDeleted: true },
    }),
  ]);

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Locks in the estimate as a contract. From this point on, line items are
 * only editable via change orders (see assertEditableDirectly /
 * assertEditableViaChangeOrder above).
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

const COST_CATEGORIES = ["LABOR", "MATERIAL", "SUBCONTRACTOR", "OTHER"] as const;
const TRADE_SCOPES = [
  "METAL_FRAMING_DRYWALL",
  "LATH_PLASTER",
  "EIFS",
  "ACOUSTICAL_CEILINGS",
  "FIREPROOFING",
] as const;

/** Empty selection means "untagged" — a valid, common state, not an error. */
function tradeScopeFromForm(formData: FormData): (typeof TRADE_SCOPES)[number] | null {
  const raw = String(formData.get("tradeScope") ?? "");
  return TRADE_SCOPES.includes(raw as (typeof TRADE_SCOPES)[number])
    ? (raw as (typeof TRADE_SCOPES)[number])
    : null;
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

function assertOwner(user: { role: string }) {
  if (user.role !== "OWNER") {
    throw new Error("Only the account owner can manage team members");
  }
}

/** Invites a teammate by email. They join the OWNER's Company as a MEMBER
 * the next time they sign up with that email — see requireCompanyContext(). */
export async function inviteTeamMember(formData: FormData) {
  const { company, ...user } = await requireCompanyContext();
  assertOwner(user);

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    throw new Error("Email is required");
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error("Someone with that email already has an account");
  }

  try {
    await prisma.invite.create({ data: { companyId: company.id, email } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("That email has already been invited (here or elsewhere)");
    }
    throw error;
  }

  revalidatePath("/team");
}

/** Cancels a pending invite (e.g. to fix a typo). */
export async function cancelInvite(inviteId: string) {
  const { company, ...user } = await requireCompanyContext();
  assertOwner(user);

  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.companyId !== company.id) {
    throw new Error("Invite not found");
  }

  await prisma.invite.delete({ where: { id: inviteId } });

  revalidatePath("/team");
}

/** Removes a MEMBER from the company. Owners can't be removed this way. */
export async function removeTeamMember(memberUserId: string) {
  const { company, ...user } = await requireCompanyContext();
  assertOwner(user);

  const member = await prisma.user.findUnique({ where: { id: memberUserId } });
  if (!member || member.companyId !== company.id) {
    throw new Error("Team member not found");
  }
  if (member.role === "OWNER") {
    throw new Error("Owners can't be removed");
  }

  await prisma.user.delete({ where: { id: memberUserId } });

  revalidatePath("/team");
}

/** Direct edit of a contact's details. */
export async function updateContact(contactId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.companyId !== company.id) {
    throw new Error("Contact not found");
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const defaultRetainagePercent = nullableDecimalFromForm(formData, "defaultRetainagePercent");
  const paymentTermsDaysRaw = String(formData.get("paymentTermsDays") ?? "").trim();
  const standardFormsUsed = String(formData.get("standardFormsUsed") ?? "").trim();

  if (!name) {
    throw new Error("Name is required");
  }
  if (paymentTermsDaysRaw && Number.isNaN(Number(paymentTermsDaysRaw))) {
    throw new Error('"paymentTermsDays" must be a number');
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      name,
      email: email || null,
      phone: phone || null,
      address: address || null,
      defaultRetainagePercent,
      paymentTermsDays: paymentTermsDaysRaw ? Number(paymentTermsDaysRaw) : null,
      standardFormsUsed: standardFormsUsed || null,
    },
  });

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
}

const BID_INVITATION_STATUSES = ["INVITED", "SUBMITTED", "WON", "LOST", "DECLINED"] as const;

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
    },
  });

  revalidatePath(`/contacts/${contactId}`);
}

/** Updates a bid invitation's outcome (invited/submitted/won/lost/declined). */
export async function updateBidInvitationStatus(bidInvitationId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidInvitationId } });
  if (!bid || bid.companyId !== company.id) {
    throw new Error("Bid invitation not found");
  }

  const status = enumFromForm(formData, "status", BID_INVITATION_STATUSES);

  await prisma.bidInvitation.update({ where: { id: bidInvitationId }, data: { status } });

  revalidatePath(`/contacts/${bid.contactId}`);
}

export async function deleteBidInvitation(bidInvitationId: string) {
  const { company } = await requireCompanyContext();

  const bid = await prisma.bidInvitation.findUnique({ where: { id: bidInvitationId } });
  if (!bid || bid.companyId !== company.id) {
    throw new Error("Bid invitation not found");
  }

  await prisma.bidInvitation.delete({ where: { id: bidInvitationId } });

  revalidatePath(`/contacts/${bid.contactId}`);
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

/**
 * Creates a client-signing link for a job's contract. Only while ESTIMATE —
 * this is signing the estimate that becomes the contract, not something you
 * re-sign after the fact. Idempotent: if an unsigned request already
 * exists, reuses it instead of spawning a second link.
 */
export async function createSignatureRequest(jobId: string) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);

  if (job.status !== "ESTIMATE") {
    throw new Error("This job is already contracted");
  }

  const existing = await prisma.signatureRequest.findFirst({
    where: { jobId, status: "PENDING" },
  });
  if (!existing) {
    await prisma.signatureRequest.create({ data: { jobId } });
  }

  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Public action — no requireCompanyContext(). The client signing a
 * contract has no account; the unguessable token in the URL is the access
 * control. Captures signer name, IP, user agent, and an immutable snapshot
 * of what was signed at this moment (audit-only — see SignatureRequest in
 * schema.prisma and ARCHITECTURE.md).
 */
export async function signRequest(token: string, formData: FormData) {
  const request = await prisma.signatureRequest.findUnique({
    where: { token },
    include: { job: { include: { company: true, contact: true } } },
  });
  if (!request) {
    throw new Error("Signing link not found");
  }
  if (request.status === "SIGNED") {
    throw new Error("This contract has already been signed");
  }

  const signerName = String(formData.get("signerName") ?? "").trim();
  const signerEmail = String(formData.get("signerEmail") ?? "").trim();
  const agreed = formData.get("agree") === "on";
  if (!signerName) {
    throw new Error("Name is required");
  }
  if (!agreed) {
    throw new Error("You must confirm you agree before signing");
  }

  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const ipAddress = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
  const userAgent = headerList.get("user-agent");

  const lineItems = await prisma.jobLineItem.findMany({
    where: { jobId: request.jobId, isDeleted: false },
    orderBy: { createdAt: "asc" },
  });
  const total = lineItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);

  const snapshot = {
    companyName: request.job.company.name,
    jobName: request.job.name,
    clientName: request.job.contact.name,
    scope: request.job.scope,
    total,
    lineItems: lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitPrice: item.unitPrice?.toString() ?? null,
    })),
  };

  await prisma.signatureRequest.update({
    where: { id: request.id },
    data: {
      status: "SIGNED",
      signedAt: new Date(),
      signerName,
      signerEmail: signerEmail || null,
      ipAddress,
      userAgent,
      snapshot,
    },
  });

  revalidatePath(`/esign/${token}`);
  revalidatePath(`/jobs/${request.jobId}`);
}

/**
 * Generates the client's portal access link. Idempotent — if a token
 * already exists, does nothing. Same access-control pattern as
 * SignatureRequest: no client login, the unguessable token is the login.
 */
export async function enablePortalAccess(contactId: string) {
  const { company } = await requireCompanyContext();

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.companyId !== company.id) {
    throw new Error("Contact not found");
  }
  if (contact.portalToken) {
    return;
  }

  const token = randomBytes(24).toString("hex");
  await prisma.contact.update({ where: { id: contactId }, data: { portalToken: token } });

  revalidatePath(`/contacts/${contactId}`);
}

async function nextInvoiceNumber(jobId: string) {
  const last = await prisma.invoice.findFirst({ where: { jobId }, orderBy: { number: "desc" } });
  return (last?.number ?? 0) + 1;
}

/** Bills the client. Only once a job is CONTRACTED or later — you don't
 * invoice an estimate nobody has agreed to yet. */
export async function createInvoice(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);

  if (job.status === "ESTIMATE") {
    throw new Error("Contract this job before invoicing it");
  }

  const description = String(formData.get("description") ?? "").trim();
  const amount = decimalFromForm(formData, "amount");
  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  const dueAt = dueRaw ? new Date(dueRaw) : null;

  const number = await nextInvoiceNumber(jobId);
  await prisma.invoice.create({
    data: { jobId, number, description: description || null, amount, dueAt },
  });

  revalidatePath(`/jobs/${jobId}`);
}

async function assertInvoiceInCompany(invoiceId: string, companyId: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { job: true } });
  if (!invoice || invoice.job.companyId !== companyId) {
    throw new Error("Invoice not found");
  }
  return invoice;
}

/** Logs a payment received against an invoice. Not a charge — just a
 * record (check, cash, card handled elsewhere). Supports partial payments;
 * an invoice's balance is always amount - SUM(payments.amount). */
export async function logPayment(jobId: string, invoiceId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);
  const invoice = await assertInvoiceInCompany(invoiceId, company.id);
  if (invoice.jobId !== jobId) {
    throw new Error("Invoice not found on this job");
  }

  const amount = decimalFromForm(formData, "amount");
  const method = String(formData.get("method") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  await prisma.payment.create({
    data: { invoiceId, amount, method: method || null, note: note || null },
  });

  revalidatePath(`/jobs/${jobId}`);
}

/** Removes a mistaken payment entry. */
export async function deletePayment(jobId: string, paymentId: string) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: { include: { job: true } } },
  });
  if (!payment || payment.invoice.job.companyId !== company.id || payment.invoice.jobId !== jobId) {
    throw new Error("Payment not found");
  }

  await prisma.payment.delete({ where: { id: paymentId } });

  revalidatePath(`/jobs/${jobId}`);
}

// QuickBooks OAuth start moved to app/api/quickbooks/start/route.ts (a
// plain Route Handler, not a Server Action) — see that file for why.

/** Ends the QuickBooks connection: best-effort revoke on Intuit's side,
 * then always removes the local record regardless of whether the revoke
 * call succeeded — an orphaned token we can no longer use is harmless. */
export async function disconnectQuickBooks() {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const connection = await prisma.quickBooksConnection.findUnique({ where: { companyId: company.id } });
  if (!connection) {
    return;
  }

  try {
    await revokeToken(connection.refreshToken);
  } catch {
    // Already revoked, expired, or a transient network error — either way,
    // proceed to remove our record.
  }

  await prisma.quickBooksConnection.delete({ where: { companyId: company.id } });

  revalidatePath("/settings");
}

/**
 * Read-only connectivity check: refreshes the access token first if it's
 * about to expire, then fetches company info from the Accounting API.
 * Called directly from a client component (not a <form action>) so its
 * return value can be shown inline.
 */
export async function testQuickBooksConnection(): Promise<QuickBooksCompanyInfo> {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const connection = await prisma.quickBooksConnection.findUnique({ where: { companyId: company.id } });
  if (!connection) {
    throw new Error("QuickBooks is not connected");
  }

  let accessToken = connection.accessToken;

  if (connection.accessTokenExpiresAt.getTime() - Date.now() < 60_000) {
    const refreshed = await refreshTokens(connection.refreshToken);
    await prisma.quickBooksConnection.update({
      where: { companyId: company.id },
      data: {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
      },
    });
    accessToken = refreshed.accessToken;
  }

  return getCompanyInfo(connection.realmId, accessToken);
}

/**
 * Generates a short AI narrative over a job's WIP figures. Recomputes the
 * exact same deterministic numbers lib/wip.ts computes for the page itself
 * (single source of truth for the math), then hands only those numbers to
 * Claude for interpretation — never lets the model touch the arithmetic.
 * On-demand only: called directly from a client component (not a <form
 * action>) so the result can be shown inline, and nothing here is
 * persisted — every click regenerates fresh rather than reading a cached
 * value, since there's no schema field to cache it in yet.
 */
export async function generateJobWipNarrative(jobId: string): Promise<string> {
  const { company } = await requireCompanyContext();
  const job = await assertJobInCompany(jobId, company.id);

  const lineItems = await prisma.jobLineItem.findMany({
    where: { jobId, isDeleted: false },
    orderBy: { createdAt: "asc" },
    include: { costEntries: true },
  });
  const invoices = await prisma.invoice.findMany({ where: { jobId } });

  const lineItemWip = lineItems.map((item) => ({
    item,
    wip: calculateLineItemWip({
      quantity: Number(item.quantity),
      unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
      budgetedUnitCost: item.budgetedUnitCost != null ? Number(item.budgetedUnitCost) : null,
      currentEstimatedUnitCost:
        item.currentEstimatedUnitCost != null ? Number(item.currentEstimatedUnitCost) : null,
      estimatedCostToComplete:
        item.estimatedCostToComplete != null ? Number(item.estimatedCostToComplete) : null,
      actualCostToDate: item.costEntries.reduce((s, entry) => s + Number(entry.amount), 0),
    }),
  }));
  const billedToDate = invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  const jobWip = calculateJobWip(
    lineItemWip.map((l) => l.wip),
    billedToDate,
  );

  return generateWipNarrative({
    jobName: job.name,
    jobStatus: job.status,
    contractValue: jobWip.contractValue,
    percentComplete: jobWip.percentComplete,
    earnedRevenue: jobWip.earnedRevenue,
    billedToDate: jobWip.billedToDate,
    overUnderBilling: jobWip.overUnderBilling,
    lineItems: lineItemWip.map(({ item, wip }) => ({
      description: item.description,
      contractValue: wip.contractValue,
      percentComplete: wip.percentComplete,
      budgetedCost: wip.budgetedCost,
      currentEstimatedCost: wip.currentEstimatedCost,
      actualCostToDate: wip.actualCostToDate,
    })),
  });
}

// --- Company profile: insurance/bonding and locations ---------------------
// All OWNER-gated, same as team/QuickBooks management: these are company-
// wide compliance and identity records, not per-job data.

const INSURANCE_POLICY_TYPES = ["GENERAL_LIABILITY", "WORKERS_COMP", "AUTO", "UMBRELLA_EXCESS"] as const;
const BOND_TYPES = ["LICENSE_BOND", "PERFORMANCE_PAYMENT_CAPACITY"] as const;
const LOCATION_TYPES = ["HQ", "BRANCH_YARD", "WAREHOUSE"] as const;
const COMPLIANCE_DOCUMENT_TYPES = [
  "LIEN_WAIVER",
  "CERTIFICATE_OF_INSURANCE",
  "CERTIFIED_PAYROLL",
  "UNION_FRINGE_BENEFIT_FILING",
  "UNION_AGREEMENT",
] as const;

function enumFromForm<T extends readonly string[]>(formData: FormData, key: string, allowed: T): T[number] {
  const raw = String(formData.get(key) ?? "");
  if (!allowed.includes(raw as T[number])) {
    throw new Error(`"${key}" must be one of: ${allowed.join(", ")}`);
  }
  return raw as T[number];
}

/** Adds a company insurance policy record (GL, workers' comp, auto, umbrella). */
export async function createInsurancePolicy(formData: FormData) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const policyType = enumFromForm(formData, "policyType", INSURANCE_POLICY_TYPES);
  const carrier = String(formData.get("carrier") ?? "").trim();
  const policyNumber = String(formData.get("policyNumber") ?? "").trim();
  const coverageLimits = String(formData.get("coverageLimits") ?? "").trim();
  const effectiveRaw = String(formData.get("effectiveDate") ?? "").trim();
  const expirationRaw = String(formData.get("expirationDate") ?? "").trim();

  if (!carrier || !policyNumber) {
    throw new Error("Carrier and policy number are required");
  }

  await prisma.companyInsurancePolicy.create({
    data: {
      companyId: company.id,
      policyType,
      carrier,
      policyNumber,
      coverageLimits: coverageLimits || null,
      effectiveDate: effectiveRaw ? new Date(effectiveRaw) : null,
      expirationDate: expirationRaw ? new Date(expirationRaw) : null,
    },
  });

  revalidatePath("/settings");
}

export async function deleteInsurancePolicy(policyId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const policy = await prisma.companyInsurancePolicy.findUnique({ where: { id: policyId } });
  if (!policy || policy.companyId !== company.id) {
    throw new Error("Insurance policy not found");
  }

  await prisma.companyInsurancePolicy.delete({ where: { id: policyId } });

  revalidatePath("/settings");
}

/** Adds a company bonding record (license bond or performance/payment capacity). */
export async function createBond(formData: FormData) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const bondType = enumFromForm(formData, "bondType", BOND_TYPES);
  const suretyName = String(formData.get("suretyName") ?? "").trim();
  const aggregateBondingCapacity = nullableDecimalFromForm(formData, "aggregateBondingCapacity");
  const singleJobLimit = nullableDecimalFromForm(formData, "singleJobLimit");
  const agentContactName = String(formData.get("agentContactName") ?? "").trim();
  const agentContactPhone = String(formData.get("agentContactPhone") ?? "").trim();
  const agentContactEmail = String(formData.get("agentContactEmail") ?? "").trim();
  const renewalRaw = String(formData.get("renewalDate") ?? "").trim();

  if (!suretyName) {
    throw new Error("Surety name is required");
  }

  await prisma.companyBond.create({
    data: {
      companyId: company.id,
      suretyName,
      bondType,
      aggregateBondingCapacity,
      singleJobLimit,
      agentContactName: agentContactName || null,
      agentContactPhone: agentContactPhone || null,
      agentContactEmail: agentContactEmail || null,
      renewalDate: renewalRaw ? new Date(renewalRaw) : null,
    },
  });

  revalidatePath("/settings");
}

export async function deleteBond(bondId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const bond = await prisma.companyBond.findUnique({ where: { id: bondId } });
  if (!bond || bond.companyId !== company.id) {
    throw new Error("Bond not found");
  }

  await prisma.companyBond.delete({ where: { id: bondId } });

  revalidatePath("/settings");
}

/** Adds a company location (HQ / branch yard / warehouse). */
export async function createCompanyLocation(formData: FormData) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const locationType = enumFromForm(formData, "locationType", LOCATION_TYPES);
  const name = String(formData.get("name") ?? "").trim();
  const addressLine1 = String(formData.get("addressLine1") ?? "").trim();
  const addressLine2 = String(formData.get("addressLine2") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const zip = String(formData.get("zip") ?? "").trim();
  const primaryContactName = String(formData.get("primaryContactName") ?? "").trim();
  const primaryContactPhone = String(formData.get("primaryContactPhone") ?? "").trim();

  if (!addressLine1 || !city || !state || !zip) {
    throw new Error("Address, city, state, and zip are required");
  }

  await prisma.companyLocation.create({
    data: {
      companyId: company.id,
      locationType,
      name: name || null,
      addressLine1,
      addressLine2: addressLine2 || null,
      city,
      state,
      zip,
      primaryContactName: primaryContactName || null,
      primaryContactPhone: primaryContactPhone || null,
    },
  });

  revalidatePath("/settings");
}

/** Deletes a company location. Any job pointing at it keeps existing via
 * ON DELETE SET NULL (schema-level), not blocked or cascaded here. */
export async function deleteCompanyLocation(locationId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const location = await prisma.companyLocation.findUnique({ where: { id: locationId } });
  if (!location || location.companyId !== company.id) {
    throw new Error("Location not found");
  }

  await prisma.companyLocation.delete({ where: { id: locationId } });

  revalidatePath("/settings");
}

const COMPLIANCE_UPLOAD_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
const COMPLIANCE_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

/** Uploads a compliance document (lien waiver, COI, certified payroll,
 * union fringe filing) and has Claude read it into structured fields —
 * see extractComplianceDocument in @prova/integrations. Not owner-gated:
 * any team member can log paperwork they receive from a sub or vendor,
 * same reasoning as addCostEntry. The extracted fields are saved as a
 * normal, editable row (aiExtracted just flags it for review, not a
 * lock) — a bad extraction is fixed the same way a typo would be. */
export async function uploadComplianceDocument(formData: FormData) {
  const { company, ...user } = await requireCompanyContext();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("A file is required");
  }
  if (!(COMPLIANCE_UPLOAD_MEDIA_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Upload a PDF, PNG, JPEG, or WEBP file");
  }
  if (file.size > COMPLIANCE_UPLOAD_MAX_BYTES) {
    throw new Error("File is too large (max 15MB)");
  }

  const jobIdRaw = String(formData.get("jobId") ?? "").trim();
  let jobId: string | null = null;
  if (jobIdRaw) {
    const job = await prisma.job.findUnique({ where: { id: jobIdRaw } });
    if (!job || job.companyId !== company.id) {
      throw new Error("Job not found");
    }
    jobId = job.id;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mediaType = file.type as (typeof COMPLIANCE_UPLOAD_MEDIA_TYPES)[number];

  const [blob, extraction] = await Promise.all([
    put(`compliance/${company.id}/${file.name}`, buffer, { access: "public", contentType: file.type }),
    extractComplianceDocument({ fileBase64: buffer.toString("base64"), mediaType, fileName: file.name }),
  ]);

  await prisma.complianceDocument.create({
    data: {
      companyId: company.id,
      jobId,
      type: extraction.type,
      partyName: extraction.partyName,
      amount: extraction.amount != null ? extraction.amount.toString() : null,
      periodStart: extraction.periodStart ? new Date(extraction.periodStart) : null,
      periodEnd: extraction.periodEnd ? new Date(extraction.periodEnd) : null,
      effectiveDate: extraction.effectiveDate ? new Date(extraction.effectiveDate) : null,
      expiresAt: extraction.expiresAt ? new Date(extraction.expiresAt) : null,
      notes: extraction.notes,
      fileUrl: blob.url,
      fileName: file.name,
      aiExtracted: true,
      uploadedByUserId: user.id,
    },
  });

  revalidatePath("/compliance");
}

/** Edits a compliance document's fields — how a bad AI extraction gets
 * fixed (same as fixing a typo, not a separate "correction" flow) but
 * also just how anyone edits a manually-entered record. Not owner-gated,
 * same reasoning as uploadComplianceDocument. */
export async function updateComplianceDocument(documentId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const document = await prisma.complianceDocument.findUnique({ where: { id: documentId } });
  if (!document || document.companyId !== company.id) {
    throw new Error("Compliance document not found");
  }

  const type = enumFromForm(formData, "type", COMPLIANCE_DOCUMENT_TYPES);
  const partyName = String(formData.get("partyName") ?? "").trim();
  if (!partyName) {
    throw new Error("Party name is required");
  }
  const amount = nullableDecimalFromForm(formData, "amount");
  const periodStartRaw = String(formData.get("periodStart") ?? "").trim();
  const periodEndRaw = String(formData.get("periodEnd") ?? "").trim();
  const effectiveRaw = String(formData.get("effectiveDate") ?? "").trim();
  const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.complianceDocument.update({
    where: { id: documentId },
    data: {
      type,
      partyName,
      amount,
      periodStart: periodStartRaw ? new Date(periodStartRaw) : null,
      periodEnd: periodEndRaw ? new Date(periodEndRaw) : null,
      effectiveDate: effectiveRaw ? new Date(effectiveRaw) : null,
      expiresAt: expiresRaw ? new Date(expiresRaw) : null,
      notes: notes || null,
    },
  });

  revalidatePath("/compliance");
}

/** Marks a compliance document RECEIVED (e.g. the lien waiver came back
 * signed, or the sub's updated COI arrived). */
export async function markComplianceDocumentReceived(documentId: string) {
  const { company } = await requireCompanyContext();

  const document = await prisma.complianceDocument.findUnique({ where: { id: documentId } });
  if (!document || document.companyId !== company.id) {
    throw new Error("Compliance document not found");
  }

  await prisma.complianceDocument.update({ where: { id: documentId }, data: { status: "RECEIVED" } });

  revalidatePath("/compliance");
}

export async function deleteComplianceDocument(documentId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const document = await prisma.complianceDocument.findUnique({ where: { id: documentId } });
  if (!document || document.companyId !== company.id) {
    throw new Error("Compliance document not found");
  }

  await prisma.complianceDocument.delete({ where: { id: documentId } });

  revalidatePath("/compliance");
}

// ---------------------------------------------------------------------------
// Vendors (Cyrus's lane — WORK-SPLIT.md task 2). Appended at the end of the
// file per WORK-SPLIT.md's shared-file rule.
// ---------------------------------------------------------------------------

/** Adds a supplier/vendor to the company directory. Trade scope is
 * optional — reuses tradeScopeFromForm, where an empty selection means
 * "serves any trade" rather than an error. */
export async function createVendor(formData: FormData) {
  const { company } = await requireCompanyContext();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Vendor name is required");
  }

  const contactName = String(formData.get("contactName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.vendor.create({
    data: {
      companyId: company.id,
      name,
      tradeScope: tradeScopeFromForm(formData),
      contactName: contactName || null,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
    },
  });

  revalidatePath("/vendors");
}

/** Removes a vendor. Owner-only, matching how every other company-level
 * record deletion is gated. */
export async function deleteVendor(vendorId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.companyId !== company.id) {
    throw new Error("Vendor not found");
  }

  await prisma.vendor.delete({ where: { id: vendorId } });

  revalidatePath("/vendors");
}

/** Edits a vendor in place. Same field rules as createVendor — an empty
 * optional field means "not set", not "leave unchanged", so the form
 * always submits every field. */
export async function updateVendor(vendorId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.companyId !== company.id) {
    throw new Error("Vendor not found");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Vendor name is required");
  }

  const contactName = String(formData.get("contactName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.vendor.update({
    where: { id: vendorId },
    data: {
      name,
      tradeScope: tradeScopeFromForm(formData),
      contactName: contactName || null,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
    },
  });

  revalidatePath("/vendors");
}

// ---------------------------------------------------------------------------
// Equipment (Cyrus's lane — WORK-SPLIT.md task 4).
// ---------------------------------------------------------------------------

/** Empty job selection means "in the yard", a normal state rather than an
 * error — same shape as tradeScopeFromForm. Validates the job belongs to
 * this company so a stray id can't attach equipment to someone else's job. */
async function assignedJobIdFromForm(formData: FormData, companyId: string) {
  const raw = String(formData.get("assignedJobId") ?? "").trim();
  if (!raw) return null;
  const job = await prisma.job.findUnique({ where: { id: raw } });
  if (!job || job.companyId !== companyId) {
    throw new Error("Job not found");
  }
  return job.id;
}

export async function createEquipment(formData: FormData) {
  const { company } = await requireCompanyContext();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Equipment name is required");
  }

  const type = String(formData.get("type") ?? "").trim();
  const assetTag = String(formData.get("assetTag") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.equipment.create({
    data: {
      companyId: company.id,
      name,
      type: type || null,
      assetTag: assetTag || null,
      assignedJobId: await assignedJobIdFromForm(formData, company.id),
      notes: notes || null,
    },
  });

  revalidatePath("/equipment");
}

export async function updateEquipment(equipmentId: string, formData: FormData) {
  const { company } = await requireCompanyContext();

  const item = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!item || item.companyId !== company.id) {
    throw new Error("Equipment not found");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("Equipment name is required");
  }

  const type = String(formData.get("type") ?? "").trim();
  const assetTag = String(formData.get("assetTag") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.equipment.update({
    where: { id: equipmentId },
    data: {
      name,
      type: type || null,
      assetTag: assetTag || null,
      assignedJobId: await assignedJobIdFromForm(formData, company.id),
      notes: notes || null,
    },
  });

  revalidatePath("/equipment");
}

export async function deleteEquipment(equipmentId: string) {
  const context = await requireCompanyContext();
  assertOwner(context);
  const { company } = context;

  const item = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!item || item.companyId !== company.id) {
    throw new Error("Equipment not found");
  }

  await prisma.equipment.delete({ where: { id: equipmentId } });

  revalidatePath("/equipment");
}
