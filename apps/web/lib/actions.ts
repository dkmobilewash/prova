"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@prova/db";
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
 * Adds a line item directly to the estimate. Because contract/budget/costing
 * all read from JobLineItem, this single insert is what "building the
 * estimate" means — nothing else needs to be told about it separately.
 */
export async function addLineItem(jobId: string, formData: FormData) {
  const { company } = await requireCompanyContext();
  await assertJobInCompany(jobId, company.id);

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
  await assertJobInCompany(jobId, company.id);

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
  await assertJobInCompany(jobId, company.id);

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
