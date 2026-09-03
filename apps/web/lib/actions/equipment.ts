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
  const { company } = await requireCapabilityForAction("MANAGE_FIELD", FIELD_ONLY);

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
  const { company } = await requireCapabilityForAction("MANAGE_FIELD", FIELD_ONLY);

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
  const context = await requireCapabilityForAction("MANAGE_FIELD", FIELD_ONLY);
  assertOwner(context);
  const { company } = context;

  const item = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!item || item.companyId !== company.id) {
    throw new Error("Equipment not found");
  }

  await prisma.equipment.delete({ where: { id: equipmentId } });

  revalidatePath("/equipment");
}
