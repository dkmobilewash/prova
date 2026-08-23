"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";

function decimalFromForm(formData: FormData, key: string): string {
  const raw = formData.get(key);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || Number.isNaN(Number(value))) {
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
  const unitPrice = decimalFromForm(formData, "unitPrice");

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
    },
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
  const unitPrice = decimalFromForm(formData, "unitPrice");

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
  const newUnitPrice = decimalFromForm(formData, "unitPrice");

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
  if (lineItem.unitPrice.toString() !== newUnitPrice) {
    edits.push({
      lineItemId: lineItem.id,
      field: "unitPrice",
      oldValue: lineItem.unitPrice.toString(),
      newValue: newUnitPrice,
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
  const unitPrice = decimalFromForm(formData, "unitPrice");

  if (!description) {
    throw new Error("Description is required");
  }

  await prisma.jobLineItem.update({
    where: { id: lineItemId },
    data: { description, unit: unit || null, quantity, unitPrice },
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

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "CONTRACTED" },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
}

const COST_CATEGORIES = ["LABOR", "MATERIAL", "SUBCONTRACTOR", "OTHER"] as const;

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

  if (!description) {
    throw new Error("Description is required");
  }

  await prisma.costEntry.create({
    data: { lineItemId, description, amount, category },
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

  if (!name) {
    throw new Error("Name is required");
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      name,
      email: email || null,
      phone: phone || null,
      address: address || null,
    },
  });

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
}
