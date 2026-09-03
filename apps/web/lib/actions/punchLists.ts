"use server";

import { revalidatePath } from "next/cache";
import { requireCapabilityForAction } from "@/lib/authz";
import { prisma } from "@prova/db";
import { assertOwner } from "./shared";

/** Every entry point to these records is a page guarded by MANAGE_FIELD,
 * so every write here answers to the same capability. A guarded page
 * in front of an open action is not a guard: the action is its own
 * endpoint and answers whoever posts to it. */
const FIELD_ONLY = "Field records aren't part of your job function. The account owner sets who sees what, on the Team page.";

async function requireOwnJobForPunchList(jobId: string, companyId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.companyId !== companyId) {
    throw new Error("Job not found");
  }
  return job;
}

export async function createPunchListItem(formData: FormData) {
  const { company, ...user } = await requireCapabilityForAction("MANAGE_FIELD", FIELD_ONLY);

  const description = String(formData.get("description") ?? "").trim();
  if (!description) {
    throw new Error("Description is required");
  }

  const jobId = String(formData.get("jobId") ?? "").trim();
  if (!jobId) {
    throw new Error("Pick a job");
  }
  await requireOwnJobForPunchList(jobId, company.id);

  await prisma.punchListItem.create({
    data: { companyId: company.id, jobId, description, raisedByUserId: user.id },
  });

  revalidatePath("/punch-lists");
}

export async function updatePunchListItem(itemId: string, formData: FormData) {
  const { company } = await requireCapabilityForAction("MANAGE_FIELD", FIELD_ONLY);

  const item = await prisma.punchListItem.findUnique({ where: { id: itemId } });
  if (!item || item.companyId !== company.id) {
    throw new Error("Punch list item not found");
  }

  const description = String(formData.get("description") ?? "").trim();
  if (!description) {
    throw new Error("Description is required");
  }

  const jobId = String(formData.get("jobId") ?? "").trim();
  if (!jobId) {
    throw new Error("Pick a job");
  }
  await requireOwnJobForPunchList(jobId, company.id);

  await prisma.punchListItem.update({
    where: { id: itemId },
    data: { description, jobId },
  });

  revalidatePath("/punch-lists");
}

/** Checking an item off is one click and reversible, so unlike delete it
 * asks nothing. completedAt is stamped alongside isDone so "when did this
 * get closed" is answerable later. */
export async function setPunchListItemDone(itemId: string, isDone: boolean) {
  const { company } = await requireCapabilityForAction("MANAGE_FIELD", FIELD_ONLY);

  const item = await prisma.punchListItem.findUnique({ where: { id: itemId } });
  if (!item || item.companyId !== company.id) {
    throw new Error("Punch list item not found");
  }

  await prisma.punchListItem.update({
    where: { id: itemId },
    data: { isDone, completedAt: isDone ? new Date() : null },
  });

  revalidatePath("/punch-lists");
}

export async function deletePunchListItem(itemId: string) {
  const context = await requireCapabilityForAction("MANAGE_FIELD", FIELD_ONLY);
  assertOwner(context);
  const { company } = context;

  const item = await prisma.punchListItem.findUnique({ where: { id: itemId } });
  if (!item || item.companyId !== company.id) {
    throw new Error("Punch list item not found");
  }

  await prisma.punchListItem.delete({ where: { id: itemId } });

  revalidatePath("/punch-lists");
}
