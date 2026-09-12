"use server";

import { revalidatePath } from "next/cache";
import { requireCapabilityForAction } from "@/lib/authz";
import { prisma } from "@prova/db";
import { createPunchListItems } from "@/lib/field/punch-list-items";
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

/**
 * One item, from the page's form.
 *
 * The body of this is `createPunchListItems` in lib/field/punch-list-items.ts
 * — lifted so the Ask command `add_punch_items` writes through the SAME
 * validations, the same in-company assertion and the same transaction rather
 * than its own copy of them. This still throws, because that is what the
 * form renders (`PunchListForm` catches and shows the message) and the
 * sentences are unchanged; the core returns them instead of throwing so a
 * card can show one, which production would otherwise redact.
 */
export async function createPunchListItem(formData: FormData) {
  const { company, ...user } = await requireCapabilityForAction("MANAGE_FIELD", FIELD_ONLY);

  const result = await createPunchListItems(company.id, String(formData.get("jobId") ?? "").trim(), {
    descriptions: [String(formData.get("description") ?? "")],
    raisedByUserId: user.id,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }

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
